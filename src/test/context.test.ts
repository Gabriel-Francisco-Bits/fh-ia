import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSession } from "../agent/session";
import { ProviderDispatcher } from "../providers/dispatcher";
import type { EditorPort } from "../workspace/context";
import type { FilePort } from "../workspace/files";
import { startSseServer } from "./helpers";

test("outbound prompt payload includes active file path and selected span", async () => {
  const grok = await startSseServer({ kind: "openai", pathSuffix: "/v1/chat/completions", reply: "ok" });
  try {

  const editor: EditorPort = {
    activeFile: {
      path: "src/app.ts",
      content: "export function greet() { return 'hi'; }\n",
    },
    selection: {
      path: "src/app.ts",
      text: "function greet",
      startLine: 1,
      endLine: 1,
    },
  };
  const files: FilePort = {
    async read() {
      throw new Error("not used");
    },
    async write() {
      throw new Error("not used");
    },
    async exists() {
      return false;
    },
  };

  const dispatcher = new ProviderDispatcher({
    bundle: {
      selected: "grok",
      claude: { id: "claude", apiKey: "unused", baseUrl: "http://127.0.0.1:9", model: "x" },
      grok: { id: "grok", apiKey: "xai-test", baseUrl: grok.url, model: "grok-test" },
      openai: { id: "openai", apiKey: "unused", baseUrl: "http://127.0.0.1:9", model: "x" },
    },
  });

  const session = new AgentSession(dispatcher, files, () => editor);
  await session.send("explain this selection", () => undefined);

  assert.equal(grok.requests.length, 1);
  const body = grok.requests[0].body;
  assert.match(body, /src\/app\.ts/);
  assert.match(body, /function greet/);
  assert.match(body, /explain this selection/);
  assert.match(body, /L1-L1/);
  } finally {
    await grok.close();
  }
});

test("@file mention is attached into the outbound payload", async () => {
  const grok = await startSseServer({ kind: "openai", pathSuffix: "/v1/chat/completions", reply: "ok" });
  try {

  const files: FilePort = {
    async read(p) {
      if (p === "lib/util.ts") {
        return "export const MAGIC = 42;\n";
      }
      throw new Error("missing " + p);
    },
    async write() {
      throw new Error("not used");
    },
    async exists() {
      return true;
    },
  };

  const dispatcher = new ProviderDispatcher({
    bundle: {
      selected: "grok",
      claude: { id: "claude", apiKey: "unused", baseUrl: "http://127.0.0.1:9", model: "x" },
      grok: { id: "grok", apiKey: "xai-test", baseUrl: grok.url, model: "grok-test" },
      openai: { id: "openai", apiKey: "unused", baseUrl: "http://127.0.0.1:9", model: "x" },
    },
  });

  const session = new AgentSession(dispatcher, files, () => ({}));
  await session.send("look at @lib/util.ts", () => undefined);
  assert.match(grok.requests[0].body, /lib\/util\.ts/);
  assert.match(grok.requests[0].body, /MAGIC = 42/);
  } finally {
    await grok.close();
  }
});
