#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SKIP_DIRS, safeResolve, toPosix } = require("./paths");

const repoRoot = path.join(__dirname, "..");
const out = path.join(repoRoot, "out");
if (!fssync.existsSync(path.join(out, "agent", "session.js"))) {
  console.error("[fh-ia] Compila primero: npm run compile");
  process.exit(1);
}

const { AgentSession } = require(path.join(out, "agent", "session.js"));
const { createTerminalCredentialResolver } = require(path.join(out, "auth", "resolve.js"));
const { resolveAuthMode, resolveFailover, resolveProviderBundle } = require(path.join(out, "config.js"));
const { MODEL_CATALOG, modelsFor } = require(path.join(out, "models.js"));
const { ProviderDispatcher } = require(path.join(out, "providers", "dispatcher.js"));
const { isProviderId } = require(path.join(out, "providers", "types.js"));
const { isAgentMode } = require(path.join(out, "agent", "modes.js"));
const { createNodeFilePort } = require(path.join(out, "workspace", "files.js"));
const { acceptEdit } = require(path.join(out, "workspace", "edits.js"));

const PORT = Number(process.env.FH_IA_EDITOR_PORT || 3847);
const WORKSPACE = path.resolve(process.argv[2] || process.env.FH_IA_WORKSPACE || process.cwd());
const PUBLIC = path.join(__dirname, "public");
const SETTINGS_PATH = path.join(os.homedir(), ".fh-ia", "settings.json");

function loadStore() {
  try {
    return JSON.parse(fssync.readFileSync(SETTINGS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function fileConfig() {
  const store = loadStore();
  return {
    get(key) {
      if (Object.prototype.hasOwnProperty.call(store, key)) {
        return store[key];
      }
      return undefined;
    },
  };
}

function makeDispatcher(provider, model) {
  const cfg = fileConfig();
  const bundle = resolveProviderBundle(cfg);
  if (provider && isProviderId(provider)) {
    bundle.selected = provider;
  }
  if (model && bundle[bundle.selected]) {
    bundle[bundle.selected] = { ...bundle[bundle.selected], model };
  }
  const dispatcher = new ProviderDispatcher({
    bundle,
    failover: resolveFailover(cfg),
    credentials: createTerminalCredentialResolver({
      home: os.homedir(),
      env: process.env,
      authMode: () => resolveAuthMode(cfg),
    }),
  });
  dispatcher.setSelected(bundle.selected);
  return dispatcher;
}

const sessions = new Map();
const filesPort = createNodeFilePort(WORKSPACE);

function sessionFor(id, provider, model) {
  let rec = sessions.get(id);
  if (!rec) {
    const dispatcher = makeDispatcher(provider, model);
    rec = { dispatcher, activePath: "" };
    rec.agent = new AgentSession(dispatcher, filesPort, () => editorPort(rec), os.homedir());
    sessions.set(id, rec);
    return rec;
  }
  const cfg = fileConfig();
  const bundle = resolveProviderBundle(cfg);
  if (provider && isProviderId(provider)) {
    bundle.selected = provider;
  }
  if (model && bundle[bundle.selected]) {
    bundle[bundle.selected] = { ...bundle[bundle.selected], model };
  }
  rec.dispatcher.updateBundle(bundle);
  rec.dispatcher.updateFailover(resolveFailover(cfg));
  rec.dispatcher.setSelected(bundle.selected);
  return rec;
}

function editorPort(rec) {
  const port = { workspaceRoot: WORKSPACE };
  if (rec.activePath) {
    try {
      const abs = safeResolve(WORKSPACE, rec.activePath);
      const content = fssync.readFileSync(abs, "utf8");
      port.activeFile = { path: rec.activePath, content };
    } catch {
      // ignore
    }
  }
  return port;
}

function mime(file) {
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  return "text/html; charset=utf-8";
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

async function listDir(rel) {
  const abs = safeResolve(WORKSPACE, rel);
  const names = await fs.readdir(abs, { withFileTypes: true });
  const entries = [];
  for (const ent of names.sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP_DIRS.has(ent.name) || (ent.name.startsWith(".") && ent.name !== ".github" && ent.name !== ".claude" && ent.name !== ".grok")) {
      continue;
    }
    entries.push({
      name: ent.name,
      dir: ent.isDirectory(),
      path: toPosix(path.relative(WORKSPACE, path.join(abs, ent.name))),
    });
  }
  return entries;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await fs.readFile(path.join(PUBLIC, "index.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/static/")) {
      const file = path.basename(url.pathname);
      const abs = path.join(PUBLIC, file);
      const data = await fs.readFile(abs);
      res.writeHead(200, { "content-type": mime(file) });
      res.end(data);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/meta") {
      const cfg = fileConfig();
      const bundle = resolveProviderBundle(cfg);
      json(res, 200, {
        root: WORKSPACE,
        name: path.basename(WORKSPACE),
        provider: bundle.selected,
        catalog: MODEL_CATALOG,
        models: {
          claude: modelsFor("claude", bundle.claude.model),
          grok: modelsFor("grok", bundle.grok.model),
          openai: modelsFor("openai", bundle.openai.model),
          fcc: modelsFor("fcc", bundle.fcc.model),
        },
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/tree") {
      json(res, 200, { entries: await listDir(url.searchParams.get("dir") || ".") });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/file") {
      const rel = url.searchParams.get("path") || "";
      const abs = safeResolve(WORKSPACE, rel);
      const content = await fs.readFile(abs, "utf8");
      json(res, 200, { path: rel, content });
      return;
    }
    if (req.method === "PUT" && url.pathname === "/api/file") {
      const body = await readBody(req);
      const abs = safeResolve(WORKSPACE, body.path);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, String(body.content ?? ""), "utf8");
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await readBody(req);
      const id = String(body.sessionId || "default");
      const rec = sessionFor(id, body.provider, body.model);
      rec.activePath = String(body.activePath || rec.activePath || "");
      const mode = isAgentMode(String(body.mode || "ask")) ? body.mode : "ask";
      rec.dispatcher.setSelected(isProviderId(body.provider) ? body.provider : rec.dispatcher.getSelected());
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      try {
        const result = await rec.agent.send(String(body.text || ""), (ev) => {
          if (ev.type === "text") send({ type: "delta", text: ev.text });
          if (ev.type === "status") send({ type: "status", text: ev.text });
          if (ev.type === "error") send({ type: "error", message: ev.error });
        }, mode);
        send({ type: "done", text: result.text, provider: result.provider, edits: result.edits, plannedEdits: result.plannedEdits });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
        send({ type: "done", text: "", provider: rec.dispatcher.getSelected(), edits: [] });
      }
      res.end();
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/edit/accept") {
      const body = await readBody(req);
      await acceptEdit(body.edit, filesPort);
      json(res, 200, { ok: true });
      return;
    }
    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`fh-code (Monaco / VS Code engine + fh-ia)`);
  console.log(`workspace: ${WORKSPACE}`);
  console.log(`open:      http://127.0.0.1:${PORT}`);
});
