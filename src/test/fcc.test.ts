import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveFccEnabled, resolveUi } from "../config";
import { probeFcc } from "../providers/fcc";
import { requestAuthHeaders } from "../providers/headers";
import { ProviderDispatcher } from "../providers/dispatcher";
import { startSseServer } from "./helpers";

test("FCC uses Bearer auth, not x-api-key", () => {
  const headers = requestAuthHeaders({
    id: "fcc",
    apiKey: "freecc",
    baseUrl: "http://127.0.0.1:8082",
    model: "claude-sonnet-4-20250514",
  });
  assert.equal(headers.authorization, "Bearer freecc");
  assert.equal(headers["x-api-key"], undefined);
  assert.equal(headers["anthropic-version"], "2023-06-01");
});

test("FCC is enabled by default and can be turned off", () => {
  assert.equal(resolveFccEnabled({ get: () => undefined }), true);
  assert.equal(resolveFccEnabled({ get: <T>() => false as T }), false);
});

test("UI theme and sizes have sane defaults", () => {
  const ui = resolveUi({ get: () => undefined });
  assert.equal(ui.theme, "auto");
  assert.equal(ui.fontSize, 13);
  assert.equal(ui.iconSize, 16);
  assert.equal(resolveUi({ get: <T>(k: string) => (k === "fhIa.ui.theme" ? ("dark" as T) : undefined) }).theme, "dark");
});

test("dispatcher talks to FCC over Anthropic messages with Bearer token", async () => {
  const fcc = await startSseServer({ kind: "claude", pathSuffix: "/v1/messages", reply: "FCC-OK" });
  try {
    const dispatcher = new ProviderDispatcher({
      bundle: {
        selected: "fcc",
        claude: { id: "claude", apiKey: "x", baseUrl: "http://127.0.0.1:9", model: "c" },
        grok: { id: "grok", apiKey: "x", baseUrl: "http://127.0.0.1:9", model: "g" },
        openai: { id: "openai", apiKey: "x", baseUrl: "http://127.0.0.1:9", model: "o" },
        fcc: { id: "fcc", apiKey: "freecc", baseUrl: fcc.url, model: "claude-sonnet-4-20250514" },
      },
      failover: { enabled: false, order: ["fcc"] },
    });
    dispatcher.setSelected("fcc");
    const text = await dispatcher.chat([{ role: "user", content: "hola" }], () => undefined);
    assert.equal(text, "FCC-OK");
    assert.equal(fcc.requests[0].headers.authorization, "Bearer freecc");
    assert.equal(fcc.requests[0].path, "/v1/messages");
  } finally {
    await fcc.close();
  }
});

test("probeFcc reports health and model ids", async () => {
  const fcc = await startSseServer({ kind: "claude", pathSuffix: "/v1/messages", reply: "x" });
  const origFetch = fcc as unknown as { url: string };
  const http = {
    async fetch(input: string | URL) {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response("ok", { status: 200 });
      }
      if (url.endsWith("/v1/models")) {
        return new Response(JSON.stringify({ data: [{ id: "nvidia_nim/demo" }] }), { status: 200 });
      }
      return new Response("no", { status: 404 });
    },
  };
  try {
    const probe = await probeFcc({ baseUrl: origFetch.url, apiKey: "freecc", http });
    assert.equal(probe.ok, true);
    assert.deepEqual(probe.models, ["nvidia_nim/demo"]);
  } finally {
    await fcc.close();
  }
});
