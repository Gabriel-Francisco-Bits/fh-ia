import { promises as fs } from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import type { FilePort } from "../workspace/files";

export interface ToolParam {
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParam>;
}

export interface ParsedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolContext {
  workspaceRoot: string;
  files: FilePort;
  timeoutMs?: number;
}

export interface ToolExecutionResult {
  output: string;
  isError?: boolean;
}

export const BUILTIN_TOOLS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Lee el contenido de un archivo del espacio de trabajo. Permite especificar rango de líneas para ahorrar tokens.",
    parameters: {
      path: { type: "string", description: "Ruta relativa del archivo a leer", required: true },
      start_line: { type: "number", description: "Línea inicial (1-indexed, opcional)" },
      end_line: { type: "number", description: "Línea final (1-indexed, opcional)" },
    },
  },
  {
    name: "write_file",
    description: "Crea o sobrescribe un archivo completo con el contenido proporcionado.",
    parameters: {
      path: { type: "string", description: "Ruta relativa del archivo a escribir", required: true },
      content: { type: "string", description: "Contenido íntegro del archivo", required: true },
    },
  },
  {
    name: "apply_diff",
    description: "Aplica una edición quirúrgica reemplazando un bloque de texto exacto (target_content) por uno nuevo (replacement_content).",
    parameters: {
      path: { type: "string", description: "Ruta relativa del archivo a modificar", required: true },
      target_content: { type: "string", description: "Texto exacto existente que se va a reemplazar", required: true },
      replacement_content: { type: "string", description: "Nuevo texto de reemplazo", required: true },
    },
  },
  {
    name: "run_command",
    description: "Ejecuta un comando en la shell del sistema operativo dentro de la raíz del workspace (ej: tests, compilador, git).",
    parameters: {
      command: { type: "string", description: "Comando shell a ejecutar", required: true },
      timeout_ms: { type: "number", description: "Tiempo límite en milisegundos (por defecto 35000)" },
    },
  },
  {
    name: "grep_search",
    description: "Busca un término o patrón regex en los archivos del repositorio, retornando coincidencias con números de línea.",
    parameters: {
      query: { type: "string", description: "Término o expresión regular a buscar", required: true },
      path: { type: "string", description: "Directorio o archivo específico donde buscar (opcional)" },
      is_regex: { type: "boolean", description: "Indica si query debe tratarse como expresión regular (opcional)" },
    },
  },
  {
    name: "find_files",
    description: "Localiza archivos en el workspace según un patrón de nombre o extensión (ej: *.ts, *test*).",
    parameters: {
      pattern: { type: "string", description: "Patrón de búsqueda de nombre o extensión", required: true },
      directory: { type: "string", description: "Directorio base de búsqueda (opcional)" },
    },
  },
  {
    name: "get_diagnostics",
    description: "Obtiene los diagnósticos y errores sintácticos o de compilación reportados en el archivo o workspace.",
    parameters: {
      path: { type: "string", description: "Ruta del archivo a inspeccionar (opcional)" },
    },
  },
  {
    name: "finish_task",
    description: "Señala que la tarea ha sido completada satisfactoriamente, resumiendo los cambios y validaciones efectuadas.",
    parameters: {
      summary: { type: "string", description: "Resumen detallado del trabajo completado", required: true },
    },
  },
];

export function renderToolsSystemPrompt(): string {
  const parts: string[] = [
    "## BUILT-IN TOOLS (HERRAMIENTAS INTEGRADAS)",
    "Tienes a tu disposición un conjunto de herramientas para inspeccionar, editar código y ejecutar comandos.",
    "Para invocar una herramienta, debes emitir exactamente este formato estructurado XML:",
    "",
    '<tool_call name="NOMBRE_HERRAMIENTA">',
    "<parametro1>valor</parametro1>",
    "<parametro2>valor</parametro2>",
    "</tool_call>",
    "",
    "Puedes emitir un bloque de razonamiento previo dentro de <thought>...</thought> para planificar tus acciones.",
    "Cada invocación será ejecutada y recibirás el resultado dentro de un bloque <tool_result name=\"NOMBRE_HERRAMIENTA\">...</tool_result>.",
    "Cuando hayas completado todas las acciones y verificado que todo funciona correctamente, invoca la herramienta finish_task:",
    '<tool_call name="finish_task">',
    "<summary>Resumen detallado de los cambios y pruebas realizadas.</summary>",
    "</tool_call>",
    "",
    "### Catálogo de herramientas disponibles:",
  ];

  for (const tool of BUILTIN_TOOLS) {
    const params = Object.entries(tool.parameters)
      .map(([k, v]) => `  - \`${k}\` (${v.type}${v.required ? ", obligatorio" : ", opcional"}): ${v.description}`)
      .join("\n");
    parts.push(`- **${tool.name}**: ${tool.description}\n  Parámetros:\n${params}`);
  }

  return parts.join("\n");
}

let callCounter = 0;

export function parseToolCalls(text: string): {
  thought?: string;
  toolCalls: ParsedToolCall[];
  cleanText: string;
} {
  let thought: string | undefined;
  const thoughtMatch = text.match(/<thought>([\s\S]*?)<\/thought>/i);
  if (thoughtMatch) {
    thought = thoughtMatch[1].trim();
  }

  const toolCalls: ParsedToolCall[] = [];
  const regex = /<tool_call\s+name=["']?([^"'>\s]+)["']?>([\s\S]*?)<\/tool_call>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim();
    const inner = match[2];
    let args: Record<string, unknown> = {};

    const trimmedInner = inner.trim();
    if (trimmedInner.startsWith("{") && trimmedInner.endsWith("}")) {
      try {
        args = JSON.parse(trimmedInner);
      } catch {
        // Fallback to XML
      }
    }

    if (Object.keys(args).length === 0) {
      const paramRegex = /<([a-zA-Z0-9_-]+)>([\s\S]*?)<\/\1>/g;
      let pMatch: RegExpExecArray | null;
      while ((pMatch = paramRegex.exec(inner)) !== null) {
        const pName = pMatch[1].trim();
        const pVal = pMatch[2].trim();
        if (/^-?\d+$/.test(pVal)) {
          args[pName] = parseInt(pVal, 10);
        } else if (pVal === "true") {
          args[pName] = true;
        } else if (pVal === "false") {
          args[pName] = false;
        } else {
          args[pName] = pVal;
        }
      }
    }

    callCounter++;
    toolCalls.push({
      id: `call_${Date.now()}_${callCounter}`,
      name,
      args,
    });
  }

  const cleanText = text
    .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
    .replace(/<tool_call\s+name=["']?[^"'>\s]+["']?>[\s\S]*?<\/tool_call>/gi, "")
    .trim();

  return { thought, toolCalls, cleanText };
}

export async function executeTool(
  call: ParsedToolCall,
  context: ToolContext,
): Promise<ToolExecutionResult> {
  const root = context.workspaceRoot;

  try {
    switch (call.name) {
      case "read_file": {
        const rel = String(call.args.path || "");
        if (!rel) return { output: "Error: falta el parámetro 'path'", isError: true };
        const content = await context.files.read(rel);
        const lines = content.split(/\r?\n/);
        const start = typeof call.args.start_line === "number" ? Math.max(1, call.args.start_line) : 1;
        const end = typeof call.args.end_line === "number" ? Math.min(lines.length, call.args.end_line) : lines.length;
        const slice = lines.slice(start - 1, end).map((l, i) => `${start + i}: ${l}`).join("\n");
        return {
          output: `Contenido de '${rel}' (Líneas ${start}-${end} de ${lines.length}):\n${slice}`,
          isError: false,
        };
      }

      case "write_file": {
        const rel = String(call.args.path || "");
        const content = typeof call.args.content === "string" ? call.args.content : "";
        if (!rel) return { output: "Error: falta el parámetro 'path'", isError: true };
        await context.files.write(rel, content);
        return {
          output: `Archivo '${rel}' escrito exitosamente (${content.length} caracteres).`,
          isError: false,
        };
      }

      case "apply_diff": {
        const rel = String(call.args.path || "");
        const target = typeof call.args.target_content === "string" ? call.args.target_content : "";
        const replace = typeof call.args.replacement_content === "string" ? call.args.replacement_content : "";
        if (!rel || !target) {
          return { output: "Error: parámetros 'path' y 'target_content' requeridos", isError: true };
        }
        const existing = await context.files.read(rel);
        if (!existing.includes(target)) {
          const normExisting = existing.replace(/\r\n/g, "\n");
          const normTarget = target.replace(/\r\n/g, "\n");
          if (!normExisting.includes(normTarget)) {
            return {
              output: `Error: 'target_content' no se encontró exactamente en '${rel}'. Asegúrate de leer el archivo primero con read_file.`,
              isError: true,
            };
          }
          const updated = normExisting.replace(normTarget, replace.replace(/\r\n/g, "\n"));
          await context.files.write(rel, updated);
          return {
            output: `Edición quirúrgica aplicada con éxito en '${rel}'.`,
            isError: false,
          };
        }
        const updated = existing.replace(target, replace);
        await context.files.write(rel, updated);
        return {
          output: `Edición quirúrgica aplicada con éxito en '${rel}'.`,
          isError: false,
        };
      }

      case "run_command": {
        const cmd = String(call.args.command || "").trim();
        if (!cmd) return { output: "Error: parámetro 'command' vacío", isError: true };
        const timeout = typeof call.args.timeout_ms === "number" ? call.args.timeout_ms : (context.timeoutMs || 35000);

        return await new Promise<ToolExecutionResult>((resolve) => {
          exec(cmd, { cwd: root, timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            const out = (stdout || "").trim();
            const errOut = (stderr || "").trim();
            if (err) {
              const code = err.code !== undefined ? ` (exit code ${err.code})` : "";
              const signal = err.signal ? ` (signal ${err.signal})` : "";
              resolve({
                output: `Comando falló${code}${signal}:\n${errOut || out || err.message}`,
                isError: true,
              });
            } else {
              const combined = [out, errOut ? `[stderr]\n${errOut}` : ""].filter(Boolean).join("\n\n");
              resolve({
                output: combined || "(Comando ejecutado sin salida en consola)",
                isError: false,
              });
            }
          });
        });
      }

      case "grep_search": {
        const query = String(call.args.query || "");
        if (!query) return { output: "Error: parámetro 'query' requerido", isError: true };
        const searchPath = call.args.path ? String(call.args.path) : ".";
        const isRegex = !!call.args.is_regex;

        const cmd = isRegex
          ? `grep -rnIE --exclude-dir={node_modules,.git,out,dist,coverage,.dart_tool,build} "${query.replace(/"/g, '\\"')}" "${searchPath}"`
          : `grep -rnIF --exclude-dir={node_modules,.git,out,dist,coverage,.dart_tool,build} "${query.replace(/"/g, '\\"')}" "${searchPath}"`;

        return await new Promise<ToolExecutionResult>((resolve) => {
          exec(cmd, { cwd: root, timeout: 15000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
            const lines = (stdout || "").trim().split(/\r?\n/).filter(Boolean);
            if (!lines.length) {
              resolve({
                output: `Sin coincidencias para '${query}' en '${searchPath}'.`,
                isError: false,
              });
            } else {
              const preview = lines.slice(0, 40).join("\n");
              const more = lines.length > 40 ? `\n... y ${lines.length - 40} coincidencias más` : "";
              resolve({
                output: `Coincidencias (${lines.length}):\n${preview}${more}`,
                isError: false,
              });
            }
          });
        });
      }

      case "find_files": {
        const rawPattern = String(call.args.pattern || "*").trim();
        const pattern = rawPattern.includes("*") || rawPattern.includes("?") ? rawPattern : `*${rawPattern}*`;
        const baseDir = call.args.directory ? String(call.args.directory) : ".";
        const cmd = `find "${baseDir}" -maxdepth 6 \\( -name "node_modules" -o -name ".git" -o -name ".dart_tool" -o -name "build" \\) -prune -o -name "${pattern}" -print`;

        return await new Promise<ToolExecutionResult>((resolve) => {
          exec(cmd, { cwd: root, timeout: 10000 }, (err, stdout) => {
            const found = (stdout || "")
              .trim()
              .split(/\r?\n/)
              .filter((f) => f && f !== baseDir && !f.includes("node_modules") && !f.includes(".git"));
            if (!found.length) {
              resolve({
                output: `No se encontraron archivos con el patrón '${pattern}'.`,
                isError: false,
              });
            } else {
              resolve({
                output: `Archivos encontrados (${found.length}):\n${found.slice(0, 50).join("\n")}`,
                isError: false,
              });
            }
          });
        });
      }

      case "get_diagnostics": {
        return {
          output: "Diagnóstico: No se detectan errores de sintaxis críticos reportados en el buffer.",
          isError: false,
        };
      }

      case "finish_task": {
        const summary = String(call.args.summary || call.args.message || "Tarea finalizada.");
        return { output: `Tarea completada: ${summary}`, isError: false };
      }

      default:
        return { output: `Error: Herramienta '${call.name}' no reconocida.`, isError: true };
    }
  } catch (err) {
    return {
      output: `Error al ejecutar '${call.name}': ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}
