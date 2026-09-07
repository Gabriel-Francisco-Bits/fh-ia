import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runAgentLoop } from "../agent/agentLoop";
import {
  executeTool,
  parseToolCalls,
  renderToolsSystemPrompt,
  type ToolContext,
} from "../agent/tools";
import { ProviderDispatcher } from "../providers/dispatcher";
import type { StreamEvent } from "../providers/types";
import { createNodeFilePort } from "../workspace/files";
import { startSseServer } from "./helpers";

test("renderToolsSystemPrompt describes built-in tools and XML protocol", () => {
  const prompt = renderToolsSystemPrompt();
  assert.match(prompt, /read_file/);
  assert.match(prompt, /write_file/);
  assert.match(prompt, /apply_diff/);
  assert.match(prompt, /run_command/);
  assert.match(prompt, /grep_search/);
  assert.match(prompt, /find_files/);
  assert.match(prompt, /get_diagnostics/);
  assert.match(prompt, /finish_task/);
  assert.match(prompt, /<tool_call name="NOMBRE_HERRAMIENTA">/);
  assert.match(prompt, /<thought>/);
});

test("parseToolCalls extracts thoughts, tool calls, and remainder text", () => {
  const raw = `
<thought>
Debo inspeccionar el archivo package.json para ver las dependencias.
</thought>
Voy a leer el archivo ahora mismo:
<tool_call name="read_file">
{"path": "package.json"}
</tool_call>
`;

  const parsed = parseToolCalls(raw);
  assert.ok(parsed.thought);
  assert.match(parsed.thought, /Debo inspeccionar el archivo package\.json/);
  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0].name, "read_file");
  assert.deepEqual(parsed.toolCalls[0].args, { path: "package.json" });
  assert.match(parsed.cleanText, /Voy a leer el archivo ahora mismo:/);
  assert.ok(!parsed.cleanText.includes("<tool_call"));
  assert.ok(!parsed.cleanText.includes("<thought>"));
});

test("parseToolCalls handles multiple tool calls and empty thoughts", () => {
  const raw = `
<tool_call name="read_file">
{"path": "a.txt"}
</tool_call>
<tool_call name="read_file">
{"path": "b.txt"}
</tool_call>
`;

  const parsed = parseToolCalls(raw);
  assert.equal(parsed.thought, undefined);
  assert.equal(parsed.toolCalls.length, 2);
  assert.equal(parsed.toolCalls[0].args.path, "a.txt");
  assert.equal(parsed.toolCalls[1].args.path, "b.txt");
});

test("executeTool executes file and command operations safely", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fh-tools-test-"));
  const files = createNodeFilePort(dir);
  const context: ToolContext = {
    workspaceRoot: dir,
    files,
  };

  try {
    // 1. write_file
    const writeRes = await executeTool(
      {
        id: "1",
        name: "write_file",
        args: { path: "sample.txt", content: "hello world\nline 2" },
      },
      context,
    );
    assert.equal(writeRes.isError, false);
    assert.match(writeRes.output, /escrito exitosamente/);

    // 2. read_file
    const readRes = await executeTool(
      {
        id: "2",
        name: "read_file",
        args: { path: "sample.txt" },
      },
      context,
    );
    assert.equal(readRes.isError, false);
    assert.match(readRes.output, /hello world/);

    // 3. apply_diff
    const diffRes = await executeTool(
      {
        id: "3",
        name: "apply_diff",
        args: {
          path: "sample.txt",
          target_content: "hello world",
          replacement_content: "hola mundo",
        },
      },
      context,
    );
    assert.equal(diffRes.isError, false);
    const updatedContent = await readFile(path.join(dir, "sample.txt"), "utf8");
    assert.match(updatedContent, /hola mundo/);

    // 4. run_command
    const cmdRes = await executeTool(
      {
        id: "4",
        name: "run_command",
        args: { command: "echo 'buen trabajo'" },
      },
      context,
    );
    assert.equal(cmdRes.isError, false);
    assert.match(cmdRes.output, /buen trabajo/);

    // 5. find_files
    const findRes = await executeTool(
      {
        id: "5",
        name: "find_files",
        args: { pattern: "sample" },
      },
      context,
    );
    assert.equal(findRes.isError, false);
    assert.match(findRes.output, /sample\.txt/);

    // 6. grep_search
    const grepRes = await executeTool(
      {
        id: "6",
        name: "grep_search",
        args: { query: "hola mundo" },
      },
      context,
    );
    assert.equal(grepRes.isError, false);
    assert.match(grepRes.output, /sample\.txt/);

    // 7. finish_task
    const finishRes = await executeTool(
      {
        id: "7",
        name: "finish_task",
        args: { message: "Todo listo" },
      },
      context,
    );
    assert.equal(finishRes.isError, false);
    assert.match(finishRes.output, /Todo listo/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runAgentLoop orchestrates autonomous multi-turn ReAct workflow", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fh-agent-loop-"));
  await writeFile(path.join(dir, "target.txt"), "información secreta", "utf8");
  const files = createNodeFilePort(dir);

  // Server mock responding in 2 turns:
  // Turn 1: model investigates and calls read_file
  // Turn 2: model sees tool_result and calls finish_task
  const fake = await startSseServer({
    kind: "openai",
    pathSuffix: "/v1/chat/completions",
    reply: (reqIndex: number) => {
      if (reqIndex === 0) {
        return `<thought>Voy a leer target.txt primero.</thought>
<tool_call name="read_file">
{"path": "target.txt"}
</tool_call>`;
      }
      return `<thought>Ya tengo la información, la tarea ha concluido.</thought>
He obtenido la información requerida con éxito.
<tool_call name="finish_task">
{"message": "Información obtenida correctamente"}
</tool_call>`;
    },
  });

  const dispatcher = new ProviderDispatcher({
    bundle: {
      selected: "openai",
      claude: { id: "claude", apiKey: "x", baseUrl: "http://127.0.0.1:9", model: "c" },
      grok: { id: "grok", apiKey: "x", baseUrl: "http://127.0.0.1:9", model: "g" },
      openai: { id: "openai", apiKey: "x", baseUrl: fake.url, model: "gpt-4o" },
      fcc: { id: "fcc", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "f" },
      minimax: { id: "minimax", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "m" },
    },
  });

  const events: StreamEvent[] = [];

  try {
    const result = await runAgentLoop({
      dispatcher,
      files,
      workspaceRoot: dir,
      systemPrompt: "Eres un asistente autónomo.",
      history: [],
      userText: "Lee target.txt y dime qué contiene",
      onEvent: (ev) => events.push(ev),
      maxTurns: 5,
    });

    assert.equal(result.turns, 2);
    assert.match(result.text, /He obtenido la información requerida con éxito/);

    // Verify events emitted during loop
    const thoughts = events.filter((e) => e.type === "thought");
    assert.ok(thoughts.length >= 2, "debe emitir pensamientos");

    const toolStarts = events.filter((e) => e.type === "tool_call_start");
    assert.ok(toolStarts.some((e) => e.type === "tool_call_start" && e.name === "read_file"));
    assert.ok(toolStarts.some((e) => e.type === "tool_call_start" && e.name === "finish_task"));

    const toolOutputs = events.filter((e) => e.type === "tool_call_output");
    assert.ok(
      toolOutputs.some(
        (e) => e.type === "tool_call_output" && e.output.includes("información secreta"),
      ),
    );
  } finally {
    await fake.close();
    await rm(dir, { recursive: true, force: true });
  }
});
