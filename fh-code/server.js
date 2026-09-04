#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const { execFile } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const { SKIP_DIRS, safeResolve, toPosix } = require("./paths");
const { searchWorkspace } = require("./search");
const {
  getGitStatus,
  getGitDiff,
  stageFile,
  unstageFile,
  stageAll,
  commit,
  discardChanges,
} = require("./git");
const { TerminalManager } = require("./terminal");
const { getDiagnostics, extractSymbols } = require("./lsp");
const {
  readStore,
  getMergedSettings,
  updateSettings,
  resetSettings,
} = require("./settings");

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
let WORKSPACE = path.resolve(process.argv[2] || process.env.FH_IA_WORKSPACE || process.cwd());
const PUBLIC = path.join(__dirname, "public");

const terminalManager = new TerminalManager();

function fileConfig() {
  const store = readStore();
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
let filesPort = createNodeFilePort(WORKSPACE);

function setWorkspace(nextRoot) {
  WORKSPACE = path.resolve(nextRoot);
  filesPort = createNodeFilePort(WORKSPACE);
  sessions.clear();
  terminalManager.closeAll();
}

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
  const ext = (file.split(".").pop() || "").toLowerCase();
  const map = {
    css: "text/css; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    mjs: "text/javascript; charset=utf-8",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    ico: "image/x-icon",
    json: "application/json; charset=utf-8",
    html: "text/html; charset=utf-8",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
  };
  return map[ext] || "text/plain; charset=utf-8";
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
    if (
      SKIP_DIRS.has(ent.name) ||
      ent.name.endsWith(".vsix") ||
      (ent.name.startsWith(".") && ![".github", ".claude", ".grok", ".agents", ".cursor", ".codex"].includes(ent.name))
    ) {
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

    // HTML / Index
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await fs.readFile(path.join(PUBLIC, "index.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    // Static Assets
    if (req.method === "GET" && url.pathname.startsWith("/static/")) {
      const rel = url.pathname.slice("/static/".length);
      const cleaned = path.normalize(rel).replace(/^(\.\.[\/\\])+/, "");
      let abs = path.join(PUBLIC, cleaned);

      if (cleaned === "layout.js") {
        abs = path.join(__dirname, "layout.js");
      }

      // Check if file exists in PUBLIC, otherwise try local node_modules/monaco-editor
      if (!fssync.existsSync(abs) && cleaned.startsWith("vendor/monaco/")) {
        const monacoSub = cleaned.slice("vendor/monaco/".length);
        const nodeMonaco = path.join(repoRoot, "node_modules", "monaco-editor", monacoSub);
        if (fssync.existsSync(nodeMonaco)) {
          abs = nodeMonaco;
        }
      }

      try {
        const data = await fs.readFile(abs);
        res.writeHead(200, { "content-type": mime(abs) });
        res.end(data);
        return;
      } catch {
        json(res, 404, { error: "not found" });
        return;
      }
    }

    // Meta & Workspace Info
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
        settings: getMergedSettings(),
      });
      return;
    }

    // Open / Switch Folder (Issue #9)
    if (req.method === "POST" && url.pathname === "/api/workspace/open") {
      const body = await readBody(req);
      const target = path.resolve(String(body.path || ""));
      try {
        const stat = await fs.stat(target);
        if (!stat.isDirectory()) {
          json(res, 400, { error: "Path is not a directory" });
          return;
        }
        setWorkspace(target);
        json(res, 200, {
          ok: true,
          workspace: WORKSPACE,
          name: path.basename(WORKSPACE),
        });
        return;
      } catch (err) {
        json(res, 400, { error: "Directory does not exist: " + (err.message || target) });
        return;
      }
    }

    // Native System Folder Picker Dialog (Issue #9)
    if (req.method === "POST" && url.pathname === "/api/workspace/choose-dialog") {
      const picked = await new Promise((resolve) => {
        const platform = process.platform;
        if (platform === "linux") {
          execFile("zenity", ["--file-selection", "--directory", "--title=Abrir carpeta en fh-code"], (err, stdout) => {
            if (!err && stdout && stdout.trim()) {
              return resolve(stdout.trim());
            }
            execFile("kdialog", ["--getexistingdirectory", "."], (kerr, kout) => {
              if (!kerr && kout && kout.trim()) return resolve(kout.trim());
              resolve(null);
            });
          });
        } else if (platform === "darwin") {
          execFile("osascript", ["-e", 'POSIX path of (choose folder with prompt "Abrir carpeta en fh-code")'], (err, stdout) => {
            if (!err && stdout && stdout.trim()) return resolve(stdout.trim());
            resolve(null);
          });
        } else if (platform === "win32") {
          const ps = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; if($f.ShowDialog() -eq 'OK'){ $f.SelectedPath }`;
          execFile("powershell", ["-Command", ps], (err, stdout) => {
            if (!err && stdout && stdout.trim()) return resolve(stdout.trim());
            resolve(null);
          });
        } else {
          resolve(null);
        }
      });

      if (picked) {
        try {
          const stat = await fs.stat(picked);
          if (stat.isDirectory()) {
            setWorkspace(picked);
            json(res, 200, {
              ok: true,
              workspace: WORKSPACE,
              name: path.basename(WORKSPACE),
            });
            return;
          }
        } catch {
          // ignore
        }
      }
      json(res, 200, { ok: false });
      return;
    }

    // File Tree
    if (req.method === "GET" && url.pathname === "/api/tree") {
      json(res, 200, { entries: await listDir(url.searchParams.get("dir") || ".") });
      return;
    }

    // Read File
    if (req.method === "GET" && url.pathname === "/api/file") {
      const rel = url.searchParams.get("path") || "";
      const abs = safeResolve(WORKSPACE, rel);
      const content = await fs.readFile(abs, "utf8");
      json(res, 200, { path: rel, content });
      return;
    }

    // Save File
    if (req.method === "PUT" && url.pathname === "/api/file") {
      const body = await readBody(req);
      const abs = safeResolve(WORKSPACE, body.path);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, String(body.content ?? ""), "utf8");
      json(res, 200, { ok: true });
      return;
    }

    // Search in Workspace (Issue #9)
    if (req.method === "GET" && url.pathname === "/api/search") {
      const q = url.searchParams.get("q") || "";
      const caseSensitive = url.searchParams.get("caseSensitive") === "1";
      const matches = await searchWorkspace(WORKSPACE, q, { caseSensitive });
      json(res, 200, { query: q, matches });
      return;
    }

    // Git Status & Operations (Issue #10)
    if (req.method === "GET" && url.pathname === "/api/git/status") {
      const status = await getGitStatus(WORKSPACE);
      json(res, 200, status);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/git/diff") {
      const file = url.searchParams.get("path") || "";
      const staged = url.searchParams.get("staged") === "1";
      const diff = await getGitDiff(WORKSPACE, file, staged);
      json(res, 200, { file, staged, diff });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/git/stage") {
      const body = await readBody(req);
      const ok = await stageFile(WORKSPACE, body.path);
      json(res, 200, { ok });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/git/unstage") {
      const body = await readBody(req);
      const ok = await unstageFile(WORKSPACE, body.path);
      json(res, 200, { ok });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/git/stage-all") {
      const ok = await stageAll(WORKSPACE);
      json(res, 200, { ok });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/git/commit") {
      const body = await readBody(req);
      const result = await commit(WORKSPACE, body.message);
      json(res, 200, { ok: true, output: result });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/git/discard") {
      const body = await readBody(req);
      const ok = await discardChanges(WORKSPACE, body.path);
      json(res, 200, { ok });
      return;
    }

    // Integrated Terminal (Issue #10)
    if (req.method === "POST" && url.pathname === "/api/terminal/session") {
      const body = await readBody(req);
      const id = String(body.id || "default");
      const session = terminalManager.getOrCreate(id, WORKSPACE);
      json(res, 200, { id, history: session.getHistory() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/terminal/stream") {
      const id = url.searchParams.get("id") || "default";
      const session = terminalManager.getOrCreate(id, WORKSPACE);
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      const unsub = session.subscribe((data) => {
        res.write(`data: ${JSON.stringify({ output: data })}\n\n`);
      });

      req.on("close", () => {
        unsub();
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/terminal/input") {
      const body = await readBody(req);
      const id = String(body.id || "default");
      const session = terminalManager.get(id);
      if (session) {
        session.write(String(body.input || ""));
        json(res, 200, { ok: true });
      } else {
        json(res, 404, { error: "Session not found" });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/terminal/kill") {
      const body = await readBody(req);
      const id = String(body.id || "default");
      terminalManager.close(id);
      json(res, 200, { ok: true });
      return;
    }

    // LSP & Diagnostics (Issue #11)
    if (req.method === "POST" && url.pathname === "/api/lsp/diagnostics") {
      const body = await readBody(req);
      const diags = await getDiagnostics(String(body.path || ""), String(body.content || ""), String(body.language || ""));
      json(res, 200, { diagnostics: diags });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/lsp/symbols") {
      const body = await readBody(req);
      const symbols = extractSymbols(String(body.content || ""), String(body.language || ""));
      json(res, 200, { symbols });
      return;
    }

    // Settings API (Issue #13)
    if (req.method === "GET" && url.pathname === "/api/settings") {
      json(res, 200, getMergedSettings());
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/settings") {
      const body = await readBody(req);
      const updated = await updateSettings(body);
      // Refresh active dispatchers
      for (const rec of sessions.values()) {
        const cfg = fileConfig();
        const bundle = resolveProviderBundle(cfg);
        rec.dispatcher.updateBundle(bundle);
        rec.dispatcher.updateFailover(resolveFailover(cfg));
      }
      json(res, 200, { ok: true, settings: updated });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/settings/reset") {
      const reset = await resetSettings();
      for (const rec of sessions.values()) {
        const cfg = fileConfig();
        const bundle = resolveProviderBundle(cfg);
        rec.dispatcher.updateBundle(bundle);
        rec.dispatcher.updateFailover(resolveFailover(cfg));
      }
      json(res, 200, { ok: true, settings: reset });
      return;
    }

    // Chat / Agent
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

    // Accept Edit (Issue #9 & #13)
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

function startServer(listenPort = PORT, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, host, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : listenPort;
      console.log(`fh-code (Monaco / VS Code engine + fh-ia)`);
      console.log(`workspace: ${WORKSPACE}`);
      console.log(`open:      http://127.0.0.1:${port}`);
      resolve({ server, port, workspace: WORKSPACE });
    });
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  startServer,
  PORT,
  get WORKSPACE() { return WORKSPACE; },
  setWorkspace,
};
