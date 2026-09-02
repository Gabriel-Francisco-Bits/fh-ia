import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createTerminalCredentialResolver, memoryTextFiles } from "../auth/resolve";
import { grokAuthPath } from "../auth/grokSession";
import { claudeCredentialsPath } from "../auth/claudeSession";
import { ProviderDispatcher } from "../providers/dispatcher";
import type { ProviderBundle, ProviderSettings } from "../providers/types";
import { startSseServer } from "./helpers";

function grokSettings(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
  return {
    id: "grok",
    apiKey: "",
    baseUrl: "https://api.x.ai",
    model: "grok-test",
    ...overrides,
  };
}

function emptyBundle(base: { claude: string; grok: string; openai: string }): ProviderBundle {
  return {
    selected: "grok",
    claude: { id: "claude", apiKey: "", baseUrl: base.claude, model: "claude-test" },
    grok: { id: "grok", apiKey: "", baseUrl: base.grok, model: "grok-test" },
    openai: { id: "openai", apiKey: "", baseUrl: base.openai, model: "gpt-test" },
  };
}

test("settings API key wins over terminal session", async () => {
  const home = "/tmp/fh-ia-fake-home-settings";
  const files = memoryTextFiles({
    [grokAuthPath(home)]: JSON.stringify({
      "https://auth.x.ai::c": {
        key: "session-should-not-be-used",
        expires_at: "2099-01-01T00:00:00.000Z",
      },
    }),
  });
  const resolver = createTerminalCredentialResolver({
    home,
    files,
    env: { XAI_API_KEY: "env-should-not-be-used" },
    authMode: "auto",
  });
  const resolved = await resolver.resolve("grok", grokSettings({ apiKey: "settings-key" }));
  assert.equal(resolved.apiKey, "settings-key");
  assert.equal(resolved.authKind, "apiKey");
  assert.equal(resolved.authSource, "settings");
});

test("grok terminal session is used when no API key is set", async () => {
  const grokApi = await startSseServer({ kind: "openai", pathSuffix: "/v1/chat/completions", reply: "FROM-SESSION" });
  const home = "/tmp/fh-ia-fake-home-session";
  const files = memoryTextFiles({
    [grokAuthPath(home)]: JSON.stringify({
      "https://auth.x.ai::c": {
        key: "oidc-session-token",
        auth_mode: "oidc",
        expires_at: "2099-01-01T00:00:00.000Z",
        oidc_issuer: "https://auth.x.ai",
        oidc_client_id: "c",
      },
    }),
  });
  try {
    const dispatcher = new ProviderDispatcher({
      bundle: emptyBundle({ claude: "http://127.0.0.1:9", grok: grokApi.url, openai: "http://127.0.0.1:9" }),
      credentials: createTerminalCredentialResolver({
        home,
        files,
        env: {},
        authMode: "auto",
      }),
    });
    dispatcher.setSelected("grok");
    const text = await dispatcher.chat([{ role: "user", content: "hi" }], () => undefined);
    assert.equal(text, "FROM-SESSION");
    assert.equal(grokApi.requests[0].headers.authorization, "Bearer oidc-session-token");
  } finally {
    await grokApi.close();
  }
});

test("terminal session beats environment API key (Grok CLI order)", async () => {
  const home = "/tmp/fh-ia-fake-home-prec";
  const files = memoryTextFiles({
    [grokAuthPath(home)]: JSON.stringify({
      "https://auth.x.ai::c": { key: "from-terminal", expires_at: "2099-01-01T00:00:00.000Z" },
    }),
  });
  const resolver = createTerminalCredentialResolver({
    home,
    files,
    env: { XAI_API_KEY: "from-env" },
    authMode: "auto",
  });
  const resolved = await resolver.resolve("grok", grokSettings());
  assert.equal(resolved.apiKey, "from-terminal");
  assert.equal(resolved.authSource, "terminal");
  assert.equal(resolved.authKind, "session");
});

test("env API key is used when not logged in via terminal", async () => {
  const resolver = createTerminalCredentialResolver({
    home: "/tmp/fh-ia-empty-home",
    files: memoryTextFiles(),
    env: { XAI_API_KEY: "env-only" },
    authMode: "auto",
  });
  const resolved = await resolver.resolve("grok", grokSettings());
  assert.equal(resolved.apiKey, "env-only");
  assert.equal(resolved.authSource, "env");
  assert.equal(resolved.authKind, "apiKey");
});

test("authMode=apiKey ignores terminal session", async () => {
  const home = "/tmp/fh-ia-fake-home-apionly";
  const files = memoryTextFiles({
    [grokAuthPath(home)]: JSON.stringify({
      "https://auth.x.ai::c": { key: "session-ignored", expires_at: "2099-01-01T00:00:00.000Z" },
    }),
  });
  const resolver = createTerminalCredentialResolver({
    home,
    files,
    env: { XAI_API_KEY: "env-key" },
    authMode: "apiKey",
  });
  const resolved = await resolver.resolve("grok", grokSettings());
  assert.equal(resolved.apiKey, "env-key");
  assert.equal(resolved.authSource, "env");
});

test("expired grok OIDC token is refreshed then sent as Bearer", async () => {
  const oidc = await listenOidc({ access_token: "refreshed-token", expires_in: 3600 });
  const grokApi = await startSseServer({ kind: "openai", pathSuffix: "/v1/chat/completions", reply: "ok" });
  const home = "/tmp/fh-ia-fake-home-refresh";
  const authFile = grokAuthPath(home);
  const files = memoryTextFiles({
    [authFile]: JSON.stringify({
      [`${oidc.issuer}::client`]: {
        key: "stale-token",
        refresh_token: "refresh-me",
        expires_at: "2020-01-01T00:00:00.000Z",
        oidc_issuer: oidc.issuer,
        oidc_client_id: "client",
      },
    }),
  });
  try {
    const dispatcher = new ProviderDispatcher({
      bundle: emptyBundle({ claude: "http://127.0.0.1:9", grok: grokApi.url, openai: "http://127.0.0.1:9" }),
      credentials: createTerminalCredentialResolver({ home, files, env: {}, authMode: "auto" }),
    });
    dispatcher.setSelected("grok");
    await dispatcher.chat([{ role: "user", content: "hi" }], () => undefined);
    assert.equal(grokApi.requests[0].headers.authorization, "Bearer refreshed-token");
    const written = JSON.parse(files.store[authFile]) as Record<string, { key: string }>;
    assert.equal(Object.values(written)[0].key, "refreshed-token");
    assert.equal(oidc.requests.some((r) => r.method === "POST"), true);
  } finally {
    await oidc.close();
    await grokApi.close();
  }
});

test("claude terminal OAuth uses Bearer, not x-api-key", async () => {
  const claudeApi = await startSseServer({ kind: "claude", pathSuffix: "/v1/messages", reply: "CLAUDE-OAUTH" });
  const home = "/tmp/fh-ia-fake-home-claude";
  const files = memoryTextFiles({
    [claudeCredentialsPath(home)]: JSON.stringify({
      claudeAiOauth: {
        accessToken: "claude-oauth-token",
        refreshToken: "r",
        expiresAt: Date.now() + 86_400_000,
        scopes: ["user:inference"],
      },
    }),
  });
  try {
    const dispatcher = new ProviderDispatcher({
      bundle: emptyBundle({ claude: claudeApi.url, grok: "http://127.0.0.1:9", openai: "http://127.0.0.1:9" }),
      credentials: createTerminalCredentialResolver({ home, files, env: {}, authMode: "auto" }),
    });
    dispatcher.setSelected("claude");
    const text = await dispatcher.chat([{ role: "user", content: "hi" }], () => undefined);
    assert.equal(text, "CLAUDE-OAUTH");
    assert.equal(claudeApi.requests[0].headers.authorization, "Bearer claude-oauth-token");
    assert.equal(claudeApi.requests[0].headers["x-api-key"], undefined);
    assert.match(String(claudeApi.requests[0].headers["anthropic-beta"] || ""), /oauth/);
  } finally {
    await claudeApi.close();
  }
});

test("missing credentials explain both API key and terminal login", async () => {
  const resolver = createTerminalCredentialResolver({
    home: "/tmp/fh-ia-no-creds",
    files: memoryTextFiles(),
    env: {},
    authMode: "auto",
  });
  await assert.rejects(() => resolver.resolve("grok", grokSettings()), /grok login/);
  await assert.rejects(() => resolver.resolve("grok", grokSettings()), /XAI_API_KEY/);
});

async function listenOidc(token: { access_token: string; expires_in: number }) {
  const requests: Array<{ method: string; url: string; body: string }> = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const url = req.url || "/";
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: req.method || "", url, body });
      if (url.includes("openid-configuration")) {
        const addr = server.address() as AddressInfo;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            issuer: `http://127.0.0.1:${addr.port}`,
            token_endpoint: `http://127.0.0.1:${addr.port}/oauth2/token`,
          }),
        );
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(token));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });
  const addr = server.address() as AddressInfo;
  return {
    issuer: `http://127.0.0.1:${addr.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
