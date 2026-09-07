const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtemp, rm, writeFile, mkdir } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { detectRunner, sanitizeErrorOutput, runValidation } = require("./runner");

test("detectRunner identifies Node/TypeScript projects via package.json", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fh-detect-node-"));
  try {
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "test-app",
        scripts: {
          compile: "tsc -p ./",
          test: "node --test",
        },
      }),
      "utf8",
    );

    const runner = await detectRunner(dir);
    assert.equal(runner.detected, true);
    assert.equal(runner.type, "node");
    assert.equal(runner.buildCmd, "npm run compile");
    assert.equal(runner.testCmd, "npm test");
    assert.equal(runner.fullCmd, "npm run compile && npm test");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("detectRunner identifies Flutter and Dart projects via pubspec.yaml", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fh-detect-flutter-"));
  try {
    // Flutter
    await writeFile(
      path.join(dir, "pubspec.yaml"),
      "name: flutter_app\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\ndependencies:\n  flutter:\n    sdk: flutter\n",
      "utf8",
    );
    const flutterRunner = await detectRunner(dir);
    assert.equal(flutterRunner.detected, true);
    assert.equal(flutterRunner.type, "flutter");
    assert.equal(flutterRunner.buildCmd, "flutter analyze");
    assert.equal(flutterRunner.testCmd, "flutter test");

    // Pure Dart
    await writeFile(
      path.join(dir, "pubspec.yaml"),
      "name: pure_dart_app\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n",
      "utf8",
    );
    const dartRunner = await detectRunner(dir);
    assert.equal(dartRunner.detected, true);
    assert.equal(dartRunner.type, "flutter");
    assert.equal(dartRunner.buildCmd, "dart analyze");
    assert.equal(dartRunner.testCmd, "dart test");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("detectRunner identifies Rust projects via Cargo.toml", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fh-detect-rust-"));
  try {
    await writeFile(
      path.join(dir, "Cargo.toml"),
      "[package]\nname = \"rust_app\"\nversion = \"0.1.0\"\n",
      "utf8",
    );
    const runner = await detectRunner(dir);
    assert.equal(runner.detected, true);
    assert.equal(runner.type, "rust");
    assert.equal(runner.buildCmd, "cargo check");
    assert.equal(runner.testCmd, "cargo test");
    assert.equal(runner.fullCmd, "cargo check && cargo test");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("detectRunner identifies Python projects via pyproject.toml / requirements.txt", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fh-detect-py-"));
  try {
    await writeFile(
      path.join(dir, "pyproject.toml"),
      "[project]\nname = \"my_py_app\"\ndependencies = [\"pytest\"]\n",
      "utf8",
    );
    const runner = await detectRunner(dir);
    assert.equal(runner.detected, true);
    assert.equal(runner.type, "python");
    assert.equal(runner.testCmd, "pytest");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("detectRunner identifies Go projects via go.mod", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fh-detect-go-"));
  try {
    await writeFile(path.join(dir, "go.mod"), "module example.com/app\n\ngo 1.22\n", "utf8");
    const runner = await detectRunner(dir);
    assert.equal(runner.detected, true);
    assert.equal(runner.type, "go");
    assert.equal(runner.testCmd, "go test ./...");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("detectRunner supports custom .fhrunner.json configuration", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fh-detect-custom-"));
  try {
    await writeFile(
      path.join(dir, ".fhrunner.json"),
      JSON.stringify({
        build: "make compile",
        test: "make test",
      }),
      "utf8",
    );
    const runner = await detectRunner(dir);
    assert.equal(runner.detected, true);
    assert.equal(runner.type, "custom");
    assert.equal(runner.buildCmd, "make compile");
    assert.equal(runner.testCmd, "make test");
    assert.equal(runner.fullCmd, "make compile && make test");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sanitizeErrorOutput strips node_modules noise and extracts file and line", () => {
  const noisyStack = `
> test-app@1.0.0 test
> node --test

✖ failing tests:

test at src/calculator.test.ts:42:15
✖ addition handles negative numbers (12.4ms)
  AssertionError [ERR_ASSERTION]: Expected 5 to equal -5
      at TestContext.<anonymous> (/home/project/src/calculator.test.ts:42:15)
      at Test.runInAsyncScope (node:async_hooks:214:14)
      at Test.run (node:internal/test_runner/test:1047:25)
      at node_modules/mocha/lib/runner.js:52:10
      at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
  ...
`;

  const sanitized = sanitizeErrorOutput(noisyStack, "/home/project");
  assert.ok(!sanitized.cleanTrace.includes("node_modules/mocha"));
  assert.ok(!sanitized.cleanTrace.includes("node:internal/process"));
  assert.ok(!sanitized.cleanTrace.includes("node:async_hooks"));
  assert.match(sanitized.cleanTrace, /AssertionError/);
  assert.equal(sanitized.file, "src/calculator.test.ts");
  assert.equal(sanitized.line, 42);
  assert.equal(sanitized.location, "L42 de src/calculator.test.ts");
  assert.match(sanitized.errorSummary, /AssertionError/);
});

test("runValidation executes test commands and handles exit codes gracefully", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fh-run-validation-"));
  try {
    // 1. Successful runner
    await writeFile(
      path.join(dir, ".fhrunner.json"),
      JSON.stringify({ test: "node -e 'process.exit(0)'" }),
      "utf8",
    );
    const passResult = await runValidation(dir);
    assert.equal(passResult.success, true);
    assert.equal(passResult.exitCode, 0);

    // 2. Failing runner
    await writeFile(
      path.join(dir, ".fhrunner.json"),
      JSON.stringify({ test: "node -e 'console.error(\"Error en test.js:10\"); process.exit(1)'" }),
      "utf8",
    );
    const failResult = await runValidation(dir);
    assert.equal(failResult.success, false);
    assert.equal(failResult.exitCode, 1);
    assert.match(failResult.sanitized.cleanTrace, /Error en test\.js:10/);
    assert.equal(failResult.sanitized.line, 10);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Self-Correction Loop in runAgentLoop intercepts test failure and recovers on subsequent turn", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fh-self-correction-loop-"));
  const { runAgentLoop } = require("../out/agent/agentLoop.js");
  const { createNodeFilePort } = require("../out/workspace/files.js");
  const { ProviderDispatcher } = require("../out/providers/dispatcher.js");
  const { startSseServer } = require("../out/test/helpers.js");

  // Archivo de código inicial
  await writeFile(path.join(dir, "calc.js"), "function add(a, b) { return a - b; }\nmodule.exports = { add };\n", "utf8");

  // Archivo de test del proyecto
  await writeFile(
    path.join(dir, "calc.test.js"),
    "const assert = require('node:assert/strict');\nconst { add } = require('./calc');\nassert.equal(add(2, 3), 5, 'add should return sum');\nconsole.log('calc test passed');\n",
    "utf8",
  );

  // Manifiesto con test que fallará inicialmente porque calc.js tiene return a - b
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "calc-test",
      scripts: { test: "node calc.test.js" },
    }),
    "utf8",
  );

  const files = createNodeFilePort(dir);

  // Mock de respuestas de IA:
  // Turn 1: IA intenta decir que ya cambió calc.js pero no corrigió el bug y llama finish_task
  // Turn 2: IA recibe el feedback de error del test, aplica el reemplazo quirúrgico con apply_diff y concluye
  let turnCount = 0;
  const fakeServer = await startSseServer({
    kind: "openai",
    pathSuffix: "/v1/chat/completions",
    reply: (reqIndex) => {
      turnCount++;
      if (reqIndex === 0) {
        // Intenta escribir un cambio todavía defectuoso
        return `<thought>Voy a modificar calc.js con un comentario</thought>
<tool_call name="write_file">
{"path": "calc.js", "content": "function add(a, b) { return a - b; }\\nmodule.exports = { add };\\n"}
</tool_call>
<tool_call name="finish_task">
{"summary": "He modificado el archivo"}
</tool_call>`;
      } else {
        // En el segundo turno, tras recibir el error del test, corrige el bug
        return `<thought>El test falló porque add resta en vez de sumar. Voy a corregirlo.</thought>
<tool_call name="apply_diff">
{"path": "calc.js", "target_content": "return a - b;", "replacement_content": "return a + b;"}
</tool_call>
<tool_call name="finish_task">
{"summary": "Bug corregido: add ahora suma correctamente."}
</tool_call>`;
      }
    },
  });

  const dispatcher = new ProviderDispatcher({
    bundle: {
      selected: "openai",
      claude: { id: "claude", apiKey: "x", baseUrl: "http://127.0.0.1:9", model: "c" },
      grok: { id: "grok", apiKey: "x", baseUrl: "http://127.0.0.1:9", model: "g" },
      openai: { id: "openai", apiKey: "x", baseUrl: fakeServer.url, model: "gpt-4o" },
      fcc: { id: "fcc", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "f" },
    },
  });

  const events = [];

  try {
    const result = await runAgentLoop({
      dispatcher,
      files,
      workspaceRoot: dir,
      systemPrompt: "Eres un agente con capacidad de autocorrección.",
      history: [],
      userText: "Corrige la función add en calc.js",
      onEvent: (ev) => events.push(ev),
      maxTurns: 5,
      maxCorrectionRetries: 3,
    });

    assert.equal(result.autoCorrectionRetries, 1, "debe haber realizado 1 reintento de autocorrección");
    assert.equal(result.validationPassed, true, "la validación final debe haber sido exitosa");
    assert.match(result.text, /Bug corregido/);

    // Verificar que se emitieron los eventos de autocorrección en streaming
    const statuses = events.filter((e) => e.type === "status").map((e) => e.text);
    assert.ok(statuses.some((s) => s.includes("Validando tests automáticos...")));
    assert.ok(statuses.some((s) => s.includes("Auto-corrigiendo (intento 1/3)")));
    assert.ok(statuses.some((s) => s.includes("Validación de tests exitosa (Green)")));
  } finally {
    await fakeServer.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Self-Correction Loop respects maximum 3 retries limit without looping infinitely", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fh-self-correction-limit-"));
  const { runAgentLoop } = require("../out/agent/agentLoop.js");
  const { createNodeFilePort } = require("../out/workspace/files.js");
  const { ProviderDispatcher } = require("../out/providers/dispatcher.js");
  const { startSseServer } = require("../out/test/helpers.js");

  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "failing-test",
      scripts: { test: "node -e 'console.error(\"Fallo persistente e irreparable en test.js:20\"); process.exit(1)'" },
    }),
    "utf8",
  );

  const files = createNodeFilePort(dir);

  // La IA aplica un cambio en cada turno pero el test siempre falla
  const fakeServer = await startSseServer({
    kind: "openai",
    pathSuffix: "/v1/chat/completions",
    reply: (reqIndex) => {
      return `<thought>Intento ${reqIndex + 1}: probando modificación</thought>
<tool_call name="write_file">
{"path": "file.js", "content": "// intento ${reqIndex + 1}"}
</tool_call>
<tool_call name="finish_task">
{"summary": "Intento de finalización"}
</tool_call>`;
    },
  });

  const dispatcher = new ProviderDispatcher({
    bundle: {
      selected: "openai",
      claude: { id: "claude", apiKey: "x", baseUrl: "http://127.0.0.1:9", model: "c" },
      grok: { id: "grok", apiKey: "x", baseUrl: "http://127.0.0.1:9", model: "g" },
      openai: { id: "openai", apiKey: "x", baseUrl: fakeServer.url, model: "gpt-4o" },
      fcc: { id: "fcc", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "f" },
    },
  });

  const events = [];

  try {
    const result = await runAgentLoop({
      dispatcher,
      files,
      workspaceRoot: dir,
      systemPrompt: "Eres un agente con autocorrección.",
      history: [],
      userText: "Haz que los tests pasen",
      onEvent: (ev) => events.push(ev),
      maxTurns: 10,
      maxCorrectionRetries: 3,
    });

    assert.equal(result.autoCorrectionRetries, 3, "debe detenerse al alcanzar el límite de 3 reintentos");
    assert.equal(result.validationPassed, false, "la validación final debe reportar no exitosa");

    const statuses = events.filter((e) => e.type === "status").map((e) => e.text);
    assert.ok(statuses.some((s) => s.includes("Límite de autocorrección alcanzado (3 intentos)")));
    assert.match(result.text, /Límite de autocorrección alcanzado|validación falló tras 3 intentos/i);
  } finally {
    await fakeServer.close();
    await rm(dir, { recursive: true, force: true });
  }
});
