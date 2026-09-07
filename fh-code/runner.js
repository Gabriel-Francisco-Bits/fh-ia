const fs = require("node:fs/promises");
const fssync = require("node:fs");
const path = require("node:path");
const { exec } = require("node:child_process");

/**
 * Detecta el runner de pruebas y compilación según los manifiestos presentes en el workspace.
 * @param {string} workspaceRoot
 * @returns {Promise<{
 *   type: "node" | "flutter" | "rust" | "python" | "go" | "custom" | "none",
 *   buildCmd?: string,
 *   testCmd?: string,
 *   fullCmd: string,
 *   manifest: string,
 *   detected: boolean
 * }>}
 */
async function detectRunner(workspaceRoot) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    return { type: "none", fullCmd: "", manifest: "", detected: false };
  }

  // 1. Configuración explícita personalizada (.fhrunner.json o .fh-code/runner.json)
  const customPaths = [
    path.join(workspaceRoot, ".fhrunner.json"),
    path.join(workspaceRoot, ".fh-code", "runner.json"),
  ];
  for (const cPath of customPaths) {
    if (fssync.existsSync(cPath)) {
      try {
        const content = JSON.parse(fssync.readFileSync(cPath, "utf8"));
        const testCmd = content.testCmd || content.test;
        const buildCmd = content.buildCmd || content.build;
        const fullCmd = [buildCmd, testCmd].filter(Boolean).join(" && ");
        return {
          type: "custom",
          buildCmd,
          testCmd,
          fullCmd: fullCmd || "npm test",
          manifest: path.basename(cPath),
          detected: true,
        };
      } catch {
        // Formato inválido, continuar detección automática
      }
    }
  }

  // 2. Node / TypeScript / JavaScript (package.json)
  const pkgPath = path.join(workspaceRoot, "package.json");
  if (fssync.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fssync.readFileSync(pkgPath, "utf8"));
      const scripts = pkg.scripts || {};
      let buildCmd;
      let testCmd;

      if (scripts.test && !scripts.test.includes("no test specified")) {
        testCmd = "npm test";
      }

      if (scripts.compile) {
        buildCmd = "npm run compile";
      } else if (scripts.build) {
        buildCmd = "npm run build";
      } else if (fssync.existsSync(path.join(workspaceRoot, "tsconfig.json"))) {
        buildCmd = "npx tsc --noEmit";
      }

      // Si no hay test script específico pero sí compilación TypeScript
      if (!testCmd && buildCmd) {
        testCmd = buildCmd;
        buildCmd = undefined;
      } else if (!testCmd && !buildCmd) {
        testCmd = "npm test";
      }

      const fullCmd = [buildCmd, testCmd].filter(Boolean).join(" && ");
      return {
        type: "node",
        buildCmd,
        testCmd,
        fullCmd: fullCmd || "npm test",
        manifest: "package.json",
        detected: true,
      };
    } catch {
      return {
        type: "node",
        testCmd: "npm test",
        fullCmd: "npm test",
        manifest: "package.json",
        detected: true,
      };
    }
  }

  // 3. Flutter / Dart (pubspec.yaml)
  const pubspecPath = path.join(workspaceRoot, "pubspec.yaml");
  if (fssync.existsSync(pubspecPath)) {
    let hasFlutter = false;
    try {
      const pubspec = fssync.readFileSync(pubspecPath, "utf8");
      hasFlutter = /sdk:\s*flutter/i.test(pubspec);
    } catch {
      hasFlutter = true;
    }

    if (hasFlutter) {
      return {
        type: "flutter",
        buildCmd: "flutter analyze",
        testCmd: "flutter test",
        fullCmd: "flutter analyze && flutter test",
        manifest: "pubspec.yaml",
        detected: true,
      };
    } else {
      return {
        type: "flutter",
        buildCmd: "dart analyze",
        testCmd: "dart test",
        fullCmd: "dart analyze && dart test",
        manifest: "pubspec.yaml",
        detected: true,
      };
    }
  }

  // 4. Rust (Cargo.toml)
  const cargoPath = path.join(workspaceRoot, "Cargo.toml");
  if (fssync.existsSync(cargoPath)) {
    return {
      type: "rust",
      buildCmd: "cargo check",
      testCmd: "cargo test",
      fullCmd: "cargo check && cargo test",
      manifest: "Cargo.toml",
      detected: true,
    };
  }

  // 5. Python (pyproject.toml, requirements.txt, pytest.ini, setup.py)
  const pyManifests = ["pyproject.toml", "requirements.txt", "pytest.ini", "setup.py"];
  for (const m of pyManifests) {
    if (fssync.existsSync(path.join(workspaceRoot, m))) {
      const hasPytest =
        m === "pytest.ini" ||
        (fssync.existsSync(path.join(workspaceRoot, "pyproject.toml")) &&
          fssync.readFileSync(path.join(workspaceRoot, "pyproject.toml"), "utf8").includes("pytest"));

      return {
        type: "python",
        testCmd: hasPytest ? "pytest" : "python -m unittest",
        fullCmd: hasPytest ? "pytest" : "python -m unittest",
        manifest: m,
        detected: true,
      };
    }
  }

  // 6. Go (go.mod)
  const goPath = path.join(workspaceRoot, "go.mod");
  if (fssync.existsSync(goPath)) {
    return {
      type: "go",
      testCmd: "go test ./...",
      fullCmd: "go test ./...",
      manifest: "go.mod",
      detected: true,
    };
  }

  return { type: "none", fullCmd: "", manifest: "", detected: false };
}

/**
 * Sanitiza la traza de error de pruebas o compilación para optimizar tokens:
 * - Filtra líneas internas de node_modules, librerías del sistema y advertencias ruidosas.
 * - Extrae el archivo y línea causante si se detecta en la salida.
 * - Limita la cantidad de líneas preservando el núcleo del error.
 *
 * @param {string} rawOutput Salida combinada de stdout y stderr
 * @param {string} [workspaceRoot] Raíz del workspace para normalizar rutas relativas
 * @returns {{
 *   cleanTrace: string,
 *   location?: string,
 *   file?: string,
 *   line?: number,
 *   column?: number,
 *   errorSummary: string
 * }}
 */
function sanitizeErrorOutput(rawOutput, workspaceRoot = "") {
  if (!rawOutput || typeof rawOutput !== "string") {
    return {
      cleanTrace: "(Sin salida de error)",
      errorSummary: "Error desconocido",
    };
  }

  const lines = rawOutput.split(/\r?\n/);
  const relevantLines = [];
  let file;
  let line;
  let column;
  let errorSummary = "";

  // Patrones para localizar archivo y línea causante
  // Ejemplos:
  // at /path/to/main.ts:45:10
  // main.ts:45:10 - error TS2322: ...
  // AssertionError: ... at main.test.js:25:5
  // File "test_app.py", line 42, in test_calc
  // src/main.rs:15:5: error: ...
  const locRegexes = [
    /(?:at\s+)?(?:.*?\(?)([\w\-./\\]+\.(?:ts|js|jsx|tsx|dart|rs|py|go)):(\d+)(?::(\d+))?\)?/,
    /File\s+["']([\w\-./\\]+\.(?:py|pyw))["'],\s+line\s+(\d+)/i,
    /-->\s+([\w\-./\\]+\.(?:rs|dart)):(\d+):(\d+)/,
  ];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    // Descartar líneas vacías repetidas o excesivo ruido de entorno
    if (!trimmed) continue;

    // Descartar trazas irrelevantes de node_modules o procesos internos de Node
    if (
      trimmed.includes("node_modules/") ||
      trimmed.includes("node:internal/") ||
      trimmed.includes("node:async_hooks") ||
      trimmed.includes("processTicksAndRejections") ||
      trimmed.includes("startSubtestAfterBootstrap")
    ) {
      continue;
    }

    // Descartar advertencias cosméticas o avisos de paquete
    if (
      trimmed.startsWith("npm notice") ||
      trimmed.startsWith("npm warn") ||
      trimmed.startsWith("warning: unused import") && relevantLines.length > 10
    ) {
      continue;
    }

    // Buscar ubicación relevante si aún no la hemos detectado
    if (!file) {
      for (const rx of locRegexes) {
        const m = trimmed.match(rx);
        if (m) {
          const matchedFile = m[1];
          if (!matchedFile.includes("node_modules") && !matchedFile.startsWith("node:")) {
            file = matchedFile;
            line = parseInt(m[2], 10);
            if (m[3]) {
              column = parseInt(m[3], 10);
            }
            // Normalizar a ruta relativa si contiene la raíz
            if (workspaceRoot && file.startsWith(workspaceRoot)) {
              file = path.relative(workspaceRoot, file);
            }
            break;
          }
        }
      }
    }

    // Detectar resumen del error (priorizar mensajes específicos sobre cabeceras de test)
    if (/AssertionError/i.test(trimmed) || /Exception/i.test(trimmed) || /Error:/i.test(trimmed)) {
      errorSummary = trimmed.slice(0, 120);
    } else if (!errorSummary && !trimmed.toLowerCase().includes("failing tests")) {
      if (
        /error/i.test(trimmed) ||
        /failed/i.test(trimmed) ||
        /FAIL/i.test(trimmed)
      ) {
        errorSummary = trimmed.slice(0, 120);
      }
    }

    relevantLines.push(rawLine);
  }

  // Si no se encontró un resumen explícito, tomar la primera línea relevante
  if (!errorSummary && relevantLines.length > 0) {
    errorSummary = relevantLines[0].trim().slice(0, 120);
  }

  // Limitar longitud para evitar saturación de tokens (máximo 40 líneas relevantes)
  const cappedLines = relevantLines.slice(0, 40);
  if (relevantLines.length > 40) {
    cappedLines.push(`... [${relevantLines.length - 40} líneas adicionales omitidas para optimizar contexto]`);
  }

  const cleanTrace = cappedLines.join("\n").trim();
  const location = file ? `L${line || 1} de ${file}` : undefined;

  return {
    cleanTrace: cleanTrace || rawOutput.slice(0, 500),
    location,
    file,
    line,
    column,
    errorSummary: errorSummary || "Error durante la validación",
  };
}

/**
 * Ejecuta el runner detectado en el workspace con timeout y captura completa.
 * @param {string} workspaceRoot
 * @param {{ timeoutMs?: number, commandOverride?: string }} [options]
 * @returns {Promise<{
 *   success: boolean,
 *   exitCode: number,
 *   command: string,
 *   rawOutput: string,
 *   sanitized: ReturnType<typeof sanitizeErrorOutput>,
 *   durationMs: number
 * }>}
 */
async function runValidation(workspaceRoot, options = {}) {
  const runner = await detectRunner(workspaceRoot);
  const command = options.commandOverride || runner.fullCmd;

  if (!command || !runner.detected) {
    return {
      success: true,
      exitCode: 0,
      command: "(Sin runner de validación detectado)",
      rawOutput: "",
      sanitized: { cleanTrace: "", errorSummary: "" },
      durationMs: 0,
    };
  }

  const timeoutMs = options.timeoutMs || 45000;
  const startTime = Date.now();

  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd: workspaceRoot,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, CI: "true", NODE_ENV: "test" },
      },
      (err, stdout, stderr) => {
        const durationMs = Date.now() - startTime;
        const out = stdout || "";
        const errOut = stderr || "";
        const combined = [out, errOut ? `[stderr]\n${errOut}` : ""].filter(Boolean).join("\n\n");
        const exitCode = err ? (typeof err.code === "number" ? err.code : 1) : 0;
        const success = exitCode === 0;

        const sanitized = success
          ? { cleanTrace: "", errorSummary: "" }
          : sanitizeErrorOutput(combined, workspaceRoot);

        resolve({
          success,
          exitCode,
          command,
          rawOutput: combined,
          sanitized,
          durationMs,
        });
      }
    );
  });
}

module.exports = {
  detectRunner,
  sanitizeErrorOutput,
  runValidation,
};
