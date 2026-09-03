import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderDispatcher } from "../providers/dispatcher";
import { failoverChain, parseFailoverOrder } from "../providers/failover";
import type { ProviderBundle, StreamEvent } from "../providers/types";
import { startFailingServer, startSseServer } from "./helpers";

test("failover chain starts with preferred then configured order", () => {
  assert.deepEqual(failoverChain("openai", parseFailoverOrder("grok,claude"), ["claude", "grok", "openai"]), [
    "openai",
    "grok",
    "claude",
  ]);
});

test("when preferred provider returns 503, dispatcher fails over to the next IA", async () => {
  const down = await startFailingServer({ status: 503, body: '{"error":"busy"}' });
  const claude = await startSseServer({ kind: "claude", pathSuffix: "/v1/messages", reply: "CLAUDE-FAILOVER" });
  try {
    const bundle: ProviderBundle = {
      selected: "grok",
      grok: { id: "grok", apiKey: "xai-test", baseUrl: down.url, model: "grok-test" },
      claude: { id: "claude", apiKey: "sk-ant-test", baseUrl: claude.url, model: "claude-test" },
      openai: { id: "openai", apiKey: "sk-test", baseUrl: "http://127.0.0.1:9", model: "gpt-test" },
      fcc: { id: "fcc", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "fcc-test" },
    };
    const dispatcher = new ProviderDispatcher({
      bundle,
      failover: { enabled: true, order: ["grok", "claude", "openai"] },
    });
    dispatcher.setSelected("grok");
    const events: StreamEvent[] = [];
    const text = await dispatcher.chat([{ role: "user", content: "hello" }], (e) => events.push(e));
    assert.equal(text, "CLAUDE-FAILOVER");
    assert.equal(dispatcher.getLastUsed(), "claude");
    assert.equal(down.requests.length, 1);
    assert.equal(claude.requests.length, 1);
    assert.match(claude.requests[0].body, /hello/);
    const status = events.find((e) => e.type === "status");
    assert.ok(status && status.type === "status");
    assert.match(status.text, /Failover/);
    assert.match(status.text, /claude/);
  } finally {
    await down.close();
    await claude.close();
  }
});

test("failover disabled does not call the next provider", async () => {
  const down = await startFailingServer({ status: 500 });
  const claude = await startSseServer({ kind: "claude", pathSuffix: "/v1/messages", reply: "SHOULD-NOT" });
  try {
    const dispatcher = new ProviderDispatcher({
      bundle: {
        selected: "grok",
        grok: { id: "grok", apiKey: "xai-test", baseUrl: down.url, model: "g" },
        claude: { id: "claude", apiKey: "sk-ant-test", baseUrl: claude.url, model: "c" },
        openai: { id: "openai", apiKey: "sk", baseUrl: "http://127.0.0.1:9", model: "o" },
        fcc: { id: "fcc", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "f" },
      },
      failover: { enabled: false, order: ["grok", "claude"] },
    });
    dispatcher.setSelected("grok");
    await assert.rejects(() => dispatcher.chat([{ role: "user", content: "x" }], () => undefined));
    assert.equal(claude.requests.length, 0);
  } finally {
    await down.close();
    await claude.close();
  }
});

test("missing credential on preferred IA fails over to a configured backend", async () => {
  const grok = await startSseServer({ kind: "openai", pathSuffix: "/v1/chat/completions", reply: "GROK-OK" });
  try {
    const dispatcher = new ProviderDispatcher({
      bundle: {
        selected: "claude",
        claude: { id: "claude", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "c" },
        grok: { id: "grok", apiKey: "xai-test", baseUrl: grok.url, model: "g" },
        openai: { id: "openai", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "o" },
        fcc: { id: "fcc", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "f" },
      },
      failover: { enabled: true, order: ["claude", "grok", "openai"] },
    });
    dispatcher.setSelected("claude");
    const text = await dispatcher.chat([{ role: "user", content: "ping" }], () => undefined);
    assert.equal(text, "GROK-OK");
    assert.equal(dispatcher.getLastUsed(), "grok");
    assert.equal(grok.requests.length, 1);
  } finally {
    await grok.close();
  }
});
