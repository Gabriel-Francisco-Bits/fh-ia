import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ProviderDispatcher } from "../providers/dispatcher";
import type { ProviderBundle, StreamEvent } from "../providers/types";
import { startSseServer, type FakeServer } from "./helpers";

async function collectChat(dispatcher: ProviderDispatcher, prompt: string): Promise<string> {
  const events: StreamEvent[] = [];
  const text = await dispatcher.chat([{ role: "user", content: prompt }], (e) => events.push(e));
  const streamed = events
    .filter((e): e is { type: "text"; text: string } => e.type === "text")
    .map((e) => e.text)
    .join("");
  assert.equal(streamed, text, "streamed sink text must match returned reply");
  return text;
}

let claude: FakeServer;
let grok: FakeServer;
let openai: FakeServer;

before(async () => {
  claude = await startSseServer({ kind: "claude", pathSuffix: "/v1/messages", reply: "CLAUDE-BODY" });
  grok = await startSseServer({ kind: "openai", pathSuffix: "/v1/chat/completions", reply: "GROK-BODY" });
  openai = await startSseServer({ kind: "openai", pathSuffix: "/v1/chat/completions", reply: "OPENAI-BODY" });
});

after(async () => {
  await claude.close();
  await grok.close();
  await openai.close();
});

function bundle(): ProviderBundle {
  return {
    selected: "claude",
    claude: { id: "claude", apiKey: "sk-ant-test", baseUrl: claude.url, model: "claude-test" },
    grok: { id: "grok", apiKey: "xai-test", baseUrl: grok.url, model: "grok-test" },
    openai: { id: "openai", apiKey: "sk-openai-test", baseUrl: openai.url, model: "gpt-test" },
    fcc: { id: "fcc", apiKey: "freecc", baseUrl: "http://127.0.0.1:9", model: "fcc-test" },
    minimax: { id: "minimax", apiKey: "minimax-test-key", baseUrl: "http://127.0.0.1:9", model: "MiniMax-Text-01" },
  };
}

test("dispatcher routes Claude, Grok, and OpenAI to matching backends without reload", async () => {
  const dispatcher = new ProviderDispatcher({ bundle: bundle() });

  dispatcher.setSelected("claude");
  const claudeReply = await collectChat(dispatcher, "ping-claude");
  assert.equal(claudeReply, "CLAUDE-BODY");
  assert.equal(claude.requests.length, 1);
  assert.equal(claude.requests[0].path, "/v1/messages");
  assert.equal(claude.requests[0].host, claude.host);
  assert.equal(claude.requests[0].headers["x-api-key"], "sk-ant-test");
  assert.match(claude.requests[0].body, /ping-claude/);
  assert.equal(grok.requests.length, 0);
  assert.equal(openai.requests.length, 0);

  dispatcher.setSelected("grok");
  const grokReply = await collectChat(dispatcher, "ping-grok");
  assert.equal(grokReply, "GROK-BODY");
  assert.equal(grok.requests.length, 1);
  assert.equal(grok.requests[0].path, "/v1/chat/completions");
  assert.equal(grok.requests[0].host, grok.host);
  assert.equal(grok.requests[0].headers.authorization, "Bearer xai-test");
  assert.match(grok.requests[0].body, /ping-grok/);
  assert.equal(openai.requests.length, 0);

  dispatcher.setSelected("openai");
  const openaiReply = await collectChat(dispatcher, "ping-openai");
  assert.equal(openaiReply, "OPENAI-BODY");
  assert.equal(openai.requests.length, 1);
  assert.equal(openai.requests[0].path, "/v1/chat/completions");
  assert.equal(openai.requests[0].host, openai.host);
  assert.equal(openai.requests[0].headers.authorization, "Bearer sk-openai-test");
  assert.match(openai.requests[0].body, /ping-openai/);
});

test("dispatcher routes MiniMax API and supports Web cookie session authentication", async () => {
  const minimaxServer = await startSseServer({ kind: "openai", pathSuffix: "/v1/chat/completions", reply: "MINIMAX-OK" });
  try {
    const b: ProviderBundle = {
      ...bundle(),
      selected: "minimax",
      minimax: {
        id: "minimax",
        apiKey: "mm-key-123",
        baseUrl: minimaxServer.url + "/v1",
        model: "MiniMax-Text-01",
        cookie: "session_id=web_cookie_xyz; token=abc",
      },
    };
    const dispatcher = new ProviderDispatcher({ bundle: b });
    const reply = await collectChat(dispatcher, "ping-minimax");
    assert.equal(reply, "MINIMAX-OK");
    assert.equal(minimaxServer.requests.length, 1);
    assert.equal(minimaxServer.requests[0].headers.authorization, "Bearer mm-key-123");
    assert.equal(minimaxServer.requests[0].headers.cookie, "session_id=web_cookie_xyz; token=abc");
    assert.match(minimaxServer.requests[0].body, /ping-minimax/);
  } finally {
    await minimaxServer.close();
  }
});
