import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSession } from "../agent/session";
import { capHistory, createChatRecord, titleFromFirstMessage } from "../chats";
import { resolveAgentMode } from "../config";
import { modelsFor } from "../models";
import { ProviderDispatcher } from "../providers/dispatcher";
import { startSseServer } from "./helpers";

test("new chats start titled Nuevo chat and title comes from first prompt", () => {
  const rec = createChatRecord({
    provider: "grok",
    mode: "ask",
    model: "grok-4",
    now: 1,
  });
  assert.equal(rec.title, "Nuevo chat");
  assert.equal(rec.mode, "ask");
  assert.equal(titleFromFirstMessage("  arregla el login  "), "arregla el login");
  assert.equal(titleFromFirstMessage("x".repeat(60)).endsWith("…"), true);
});

test("model catalog keeps a custom current model at the front", () => {
  const list = modelsFor("grok", "grok-custom-lab");
  assert.equal(list[0], "grok-custom-lab");
  assert.ok(list.includes("grok-4"));
});

test("config agentMode defaults to ask", () => {
  assert.equal(resolveAgentMode({ get: () => undefined }), "ask");
  assert.equal(resolveAgentMode({ get: <T>(_k: string) => "plan" as T }), "plan");
  assert.equal(resolveAgentMode({ get: <T>(_k: string) => "nope" as T }), "ask");
});

test("independent sessions keep separate histories", async () => {
  const grok = await startSseServer({ kind: "openai", pathSuffix: "/v1/chat/completions", reply: "pong" });
  try {
    const dispatcher = new ProviderDispatcher({
      bundle: {
        selected: "grok",
        claude: { id: "claude", apiKey: "x", baseUrl: "http://127.0.0.1:9", model: "x" },
        grok: { id: "grok", apiKey: "k", baseUrl: grok.url, model: "grok-test" },
        openai: { id: "openai", apiKey: "x", baseUrl: "http://127.0.0.1:9", model: "x" },
      },
    });
    const files = {
      async read() {
        throw new Error("no");
      },
      async write() {
        throw new Error("no");
      },
      async exists() {
        return false;
      },
    };
    const a = new AgentSession(dispatcher, files, () => ({}));
    const b = new AgentSession(dispatcher, files, () => ({}));
    await a.send("hello from A", () => undefined, "ask");
    await b.send("hello from B", () => undefined, "ask");
    await a.send("follow up A", () => undefined, "ask");
    assert.equal(a.getHistory().length, 4);
    assert.equal(b.getHistory().length, 2);
    assert.match(JSON.stringify(a.getHistory()), /hello from A/);
    assert.match(JSON.stringify(a.getHistory()), /follow up A/);
    assert.equal(JSON.stringify(b.getHistory()).includes("follow up A"), false);
  } finally {
    await grok.close();
  }
});

test("plan mode returns planned edits without applying edits", async () => {
  const grok = await startSseServer({
    kind: "openai",
    pathSuffix: "/v1/chat/completions",
    reply: '<tool name="propose_edit" path="a.ts">export const n = 1;</tool>',
  });
  try {
    const dispatcher = new ProviderDispatcher({
      bundle: {
        selected: "grok",
        claude: { id: "claude", apiKey: "x", baseUrl: "http://127.0.0.1:9", model: "x" },
        grok: { id: "grok", apiKey: "k", baseUrl: grok.url, model: "grok-test" },
        openai: { id: "openai", apiKey: "x", baseUrl: "http://127.0.0.1:9", model: "x" },
      },
    });
    const files = {
      async read() {
        return "";
      },
      async write() {
        throw new Error("plan must not write");
      },
      async exists() {
        return false;
      },
    };
    const session = new AgentSession(dispatcher, files, () => ({}));
    const result = await session.send("change a.ts", () => undefined, "plan");
    assert.equal(result.edits.length, 0);
    assert.equal(result.plannedEdits.length, 1);
    assert.equal(result.plannedEdits[0].path, "a.ts");
  } finally {
    await grok.close();
  }
});

test("capHistory keeps the tail", () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ role: "user" as const, content: String(i) }));
  const capped = capHistory(items, 4);
  assert.equal(capped.length, 4);
  assert.equal(capped[0].content, "2");
});
