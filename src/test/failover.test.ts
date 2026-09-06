import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderDispatcher } from "../providers/dispatcher";
import { failoverChain, parseFailoverOrder } from "../providers/failover";
import type { ProviderBundle, StreamEvent } from "../providers/types";
import { resolveAvailableProviders, resolveProviderBundle, resolveProviderEnabled, type RawConfig } from "../config";
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

test("intra-provider multi-account failover: Primary account 503 -> Secondary account of same provider succeeds", async () => {
  const down = await startFailingServer({ status: 503, body: '{"error":"quota exceeded"}' });
  const backup = await startSseServer({ kind: "claude", pathSuffix: "/v1/messages", reply: "CLAUDE-BACKUP-OK" });
  try {
    const bundle: ProviderBundle = {
      selected: "claude",
      claude: { id: "claude", apiKey: "unused", baseUrl: "http://127.0.0.1:9", model: "c" },
      grok: { id: "grok", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "g" },
      openai: { id: "openai", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "o" },
      fcc: { id: "fcc", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "f" },
      accounts: [
        {
          id: "claude-main",
          provider: "claude",
          name: "Claude Pro (Principal)",
          apiKey: "sk-ant-main",
          baseUrl: down.url,
          model: "claude-3-5-sonnet",
          enabled: true,
        },
        {
          id: "claude-backup",
          provider: "claude",
          name: "Claude Work (Backup)",
          apiKey: "sk-ant-backup",
          baseUrl: backup.url,
          model: "claude-3-opus",
          enabled: true,
        },
      ],
    };
    const dispatcher = new ProviderDispatcher({
      bundle,
      failover: { enabled: true, order: ["claude", "grok"] },
    });
    dispatcher.setSelected("claude");
    const events: StreamEvent[] = [];
    const text = await dispatcher.chat([{ role: "user", content: "hola" }], (e) => events.push(e));

    assert.equal(text, "CLAUDE-BACKUP-OK");
    assert.equal(dispatcher.getLastUsed(), "claude");
    assert.equal(dispatcher.getLastUsedAccount()?.id, "claude-backup");
    assert.equal(down.requests.length, 1);
    assert.equal(backup.requests.length, 1);
    assert.equal(backup.requests[0].headers["x-api-key"], "sk-ant-backup");

    const status = events.find((e) => e.type === "status");
    assert.ok(status && status.type === "status");
    assert.match(status.text, /Claude Pro \(Principal\)/);
    assert.match(status.text, /Claude Work \(Backup\)/);
  } finally {
    await down.close();
    await backup.close();
  }
});

test("hierarchical failover: All accounts of primary provider fail -> falls over to next provider", async () => {
  const claude1 = await startFailingServer({ status: 429, body: '{"error":"rate_limited"}' });
  const claude2 = await startFailingServer({ status: 500, body: '{"error":"server_error"}' });
  const grok = await startSseServer({ kind: "openai", pathSuffix: "/v1/chat/completions", reply: "GROK-FALLBACK-OK" });
  try {
    const bundle: ProviderBundle = {
      selected: "claude",
      claude: { id: "claude", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "c" },
      grok: { id: "grok", apiKey: "xai-key", baseUrl: grok.url, model: "grok-4" },
      openai: { id: "openai", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "o" },
      fcc: { id: "fcc", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "f" },
      accounts: [
        {
          id: "c1",
          provider: "claude",
          name: "Claude Acc 1",
          apiKey: "k1",
          baseUrl: claude1.url,
          enabled: true,
        },
        {
          id: "c2",
          provider: "claude",
          name: "Claude Acc 2",
          apiKey: "k2",
          baseUrl: claude2.url,
          enabled: true,
        },
      ],
    };
    const dispatcher = new ProviderDispatcher({
      bundle,
      failover: { enabled: true, order: ["claude", "grok", "openai"] },
    });
    const text = await dispatcher.chat([{ role: "user", content: "test" }], () => undefined);

    assert.equal(text, "GROK-FALLBACK-OK");
    assert.equal(dispatcher.getLastUsed(), "grok");
    assert.equal(claude1.requests.length, 1);
    assert.equal(claude2.requests.length, 1);
    assert.equal(grok.requests.length, 1);
  } finally {
    await claude1.close();
    await claude2.close();
    await grok.close();
  }
});

test("disabled providers: resolveAvailableProviders and resolveProviderEnabled respect disabledProviders", () => {
  const cfg1: RawConfig = {
    get: <T>(key: string): T | undefined => {
      if (key === "fhIa.disabledProviders") return ["claude", "fcc"] as unknown as T;
      return undefined;
    },
  };
  assert.equal(resolveProviderEnabled("claude", cfg1), false);
  assert.equal(resolveProviderEnabled("fcc", cfg1), false);
  assert.equal(resolveProviderEnabled("grok", cfg1), true);
  assert.equal(resolveProviderEnabled("openai", cfg1), true);
  assert.deepEqual(resolveAvailableProviders(cfg1), ["grok", "openai"]);

  const cfg2: RawConfig = {
    get: <T>(key: string): T | undefined => {
      if (key === "fhIa.grok.enabled") return false as unknown as T;
      return undefined;
    },
  };
  assert.equal(resolveProviderEnabled("grok", cfg2), false);
  assert.equal(resolveProviderEnabled("claude", cfg2), true);
  assert.deepEqual(resolveAvailableProviders(cfg2), ["claude", "openai", "fcc"]);
});

test("disabled providers: resolveProviderBundle selects an enabled provider when preferred is disabled", () => {
  const cfg: RawConfig = {
    get: <T>(key: string): T | undefined => {
      if (key === "fhIa.provider") return "grok" as unknown as T;
      if (key === "fhIa.disabledProviders") return ["grok"] as unknown as T;
      return undefined;
    },
  };
  const bundle = resolveProviderBundle(cfg);
  assert.notEqual(bundle.selected, "grok");
  assert.ok(["claude", "openai", "fcc"].includes(bundle.selected));
});

test("disabled providers: failoverChain excludes disabled providers", () => {
  const available = ["grok", "openai"] as const;
  const chain = failoverChain("grok", parseFailoverOrder("claude,grok,openai,fcc"), available);
  assert.deepEqual(chain, ["grok", "openai"]);
});

