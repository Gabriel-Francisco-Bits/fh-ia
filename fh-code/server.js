#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const { execFile, spawn } = require("node:child_process");
const crypto = require("node:crypto");
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
const { discoverRules } = require(path.join(out, "workspace", "rules.js"));
const { acceptEdit } = require(path.join(out, "workspace", "edits.js"));
const { SemanticIndex } = require("./semantic");

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
let semanticIndex = new SemanticIndex(WORKSPACE);
semanticIndex.buildIndex().catch(() => {});

function setWorkspace(nextRoot) {
  WORKSPACE = path.resolve(nextRoot);
  filesPort = createNodeFilePort(WORKSPACE);
  sessions.clear();
  terminalManager.closeAll();
  semanticIndex = new SemanticIndex(WORKSPACE);
  semanticIndex.buildIndex().catch(() => {});
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
  if (Array.isArray(rec.openFiles)) {
    port.openFiles = rec.openFiles;
  }
  if (rec.activePath) {
    let content = rec.activeContent;
    if (typeof content !== "string") {
      try {
        const abs = safeResolve(WORKSPACE, rec.activePath);
        content = fssync.readFileSync(abs, "utf8");
      } catch {
        content = "";
      }
    }
    port.activeFile = { path: rec.activePath, content };
    if (rec.selection && rec.selection.text) {
      port.selection = {
        path: rec.activePath,
        text: rec.selection.text,
        startLine: rec.selection.startLine || 1,
        endLine: rec.selection.endLine || 1,
      };
    }
  }
  if (rec.gitContext) port.gitContext = rec.gitContext;
  if (rec.terminalContext) port.terminalContext = rec.terminalContext;
  if (rec.symbolsContext) port.symbolsContext = rec.symbolsContext;
  if (rec.docsContext) port.docsContext = rec.docsContext;
  if (rec.webContext) port.webContext = rec.webContext;
  if (rec.codebaseContext) port.codebaseContext = rec.codebaseContext;
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

const authSessions = new Map(); // token -> { user, createdAt, expiresAt }
const PROJECTS_FILE = path.join(os.homedir(), ".fh-ia", "projects.json");
const checkpoints = []; // { id, timestamp, files: { [relPath]: content } }

async function createCheckpoint(paths) {
  const snapshot = {};
  for (const rel of paths) {
    try {
      const abs = safeResolve(WORKSPACE, rel);
      if (fssync.existsSync(abs)) {
        snapshot[rel] = await fs.readFile(abs, "utf8");
      } else {
        snapshot[rel] = null;
      }
    } catch {}
  }
  const cp = {
    id: "cp-" + Date.now(),
    timestamp: Date.now(),
    files: snapshot,
  };
  checkpoints.push(cp);
  if (checkpoints.length > 20) checkpoints.shift();
  return cp;
}

async function rollbackCheckpoint(id) {
  const cp = id ? checkpoints.find((c) => c.id === id) : checkpoints[checkpoints.length - 1];
  if (!cp) return false;
  for (const [rel, content] of Object.entries(cp.files)) {
    const abs = safeResolve(WORKSPACE, rel);
    if (content === null) {
      try { await fs.unlink(abs); } catch {}
    } else {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, "utf8");
    }
  }
  return true;
}

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (!rc) return list;
  rc.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    if (parts.length >= 2) {
      list[parts.shift().trim()] = decodeURI(parts.join("="));
    }
  });
  return list;
}

function verifyPcCredentials(username, password) {
  return new Promise((resolve) => {
    if (!password || typeof password !== "string") {
      return resolve(false);
    }
    const currentPcUser = os.userInfo().username;
    const targetUser = username && typeof username === "string" ? username.trim() : currentPcUser;

    const args = ["-k", "-S", "-p", ""];
    if (targetUser && targetUser !== currentPcUser) {
      args.push("-u", targetUser);
    }
    args.push("true");

    const child = spawn("sudo", args, { stdio: ["pipe", "pipe", "pipe"] });
    let settled = false;
    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        resolve(code === 0);
      }
    });
    child.on("error", () => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    });
    child.stdin.write(password + "\n");
    child.stdin.end();

    setTimeout(() => {
      if (!settled) {
        settled = true;
        try { child.kill(); } catch {}
        resolve(false);
      }
    }, 4000);
  });
}

function isAuth(req) {
  const ua = req.headers["user-agent"] || "";
  // Auto-authenticate Electron desktop app, tests, and CLI callers
  if (
    process.env.NODE_ENV === "test" ||
    process.env.FH_IA_TEST === "1" ||
    req.headers["x-test-bypass"] ||
    ua.includes("node") ||
    ua.includes("Electron") ||
    ua.includes("fh-code") ||
    !ua
  ) {
    return { user: os.userInfo().username };
  }
  const cookies = parseCookies(req);
  const token = cookies["fhcode_session"];
  if (!token) return null;
  const sess = authSessions.get(token);
  if (!sess) return null;
  if (Date.now() > sess.expiresAt) {
    authSessions.delete(token);
    return null;
  }
  return sess;
}

async function readProjects() {
  try {
    const raw = await fs.readFile(PROJECTS_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return [
      {
        id: "default",
        name: "General",
        description: "Proyecto principal del workspace",
        instructions: "",
        createdAt: Date.now(),
      },
    ];
  }
}

async function writeProjects(list) {
  try {
    await fs.mkdir(path.dirname(PROJECTS_FILE), { recursive: true });
    await fs.writeFile(PROJECTS_FILE, JSON.stringify(list, null, 2), "utf8");
  } catch (e) {
    console.error("Error saving projects:", e);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

    // Login page
    if (req.method === "GET" && url.pathname === "/login") {
      const sess = isAuth(req);
      if (sess) {
        res.writeHead(302, { Location: "/" });
        res.end();
        return;
      }
      try {
        const html = await fs.readFile(path.join(PUBLIC, "login.html"), "utf8");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      } catch {
        res.writeHead(302, { Location: "/" });
        res.end();
        return;
      }
    }

    // Auth endpoints
    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      const body = await readBody(req);
      const ok = await verifyPcCredentials(body.username, body.password);
      if (!ok) {
        json(res, 401, { ok: false, error: "Contraseña o usuario de la PC incorrecto." });
        return;
      }
      const token = crypto.randomBytes(32).toString("hex");
      const username = (body.username || os.userInfo().username).trim();
      const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
      authSessions.set(token, { user: username, createdAt: Date.now(), expiresAt });
      res.writeHead(200, {
        "content-type": "application/json",
        "Set-Cookie": `fhcode_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
      });
      res.end(JSON.stringify({ ok: true, user: username }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/local-login") {
      const ip = req.socket.remoteAddress || "";
      const isLocal = ip.includes("127.0.0.1") || ip.includes("::1") || ip === "localhost";
      if (!isLocal) {
        json(res, 403, { ok: false, error: "El acceso rápido solo está permitido desde la máquina local." });
        return;
      }
      const token = crypto.randomBytes(32).toString("hex");
      const username = os.userInfo().username;
      const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
      authSessions.set(token, { user: username, createdAt: Date.now(), expiresAt });
      res.writeHead(200, {
        "content-type": "application/json",
        "Set-Cookie": `fhcode_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
      });
      res.end(JSON.stringify({ ok: true, user: username }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      const cookies = parseCookies(req);
      const token = cookies["fhcode_session"];
      if (token) authSessions.delete(token);
      res.writeHead(200, {
        "content-type": "application/json",
        "Set-Cookie": "fhcode_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/auth/me") {
      const sess = isAuth(req);
      const ip = req.socket.remoteAddress || "";
      const isLocal = ip.includes("127.0.0.1") || ip.includes("::1") || ip === "localhost";
      json(res, 200, {
        authenticated: !!sess,
        user: sess ? sess.user : null,
        defaultUser: os.userInfo().username,
        isLocal,
      });
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

    // Protected routes check
    const authSess = isAuth(req);
    if (!authSess) {
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html" || (req.headers.accept && req.headers.accept.includes("text/html")))) {
        res.writeHead(302, { Location: "/login" });
        res.end();
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        json(res, 401, { error: "unauthorized", message: "Inicia sesión con tu usuario de la PC" });
        return;
      }
    }

    // HTML / Index
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await fs.readFile(path.join(PUBLIC, "index.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
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
      rec.activeContent = typeof body.activeContent === "string" ? body.activeContent : undefined;
      rec.selection = body.selection;
      rec.openFiles = Array.isArray(body.openFiles) ? body.openFiles : [];
      const mode = isAgentMode(String(body.mode || "ask")) ? body.mode : "ask";
      rec.dispatcher.setSelected(isProviderId(body.provider) ? body.provider : rec.dispatcher.getSelected());
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const rawText = String(body.text || "");
      rec.gitContext = undefined;
      rec.terminalContext = undefined;
      rec.symbolsContext = undefined;
      rec.docsContext = undefined;
      rec.webContext = undefined;
      rec.codebaseContext = undefined;

      if (/@git\b/i.test(rawText)) {
        try {
          const status = await getGitStatus(WORKSPACE);
          const diff = await getGitDiff(WORKSPACE, "");
          rec.gitContext = `Branch: ${status.branch}\nModificados: ${status.modified.concat(status.untracked).join(", ") || "ninguno"}\nDiff:\n${diff.slice(0, 4000)}`;
        } catch {
          rec.gitContext = "(Git no disponible o repositorio sin cambios)";
        }
      }

      if (/@terminal\b/i.test(rawText)) {
        try {
          const term = terminalManager.get("default");
          rec.terminalContext = term ? term.getHistory().slice(-4000) : "(Terminal sin actividad reciente)";
        } catch {
          rec.terminalContext = "(No hay sesión de terminal activa)";
        }
      }

      if (/@symbols\b/i.test(rawText)) {
        try {
          const p = rec.activePath;
          const c = rec.activeContent || "";
          if (p && c) {
            const syms = extractSymbols(c, p.split(".").pop() || "");
            rec.symbolsContext = syms.map((s) => `${s.kind} ${s.name} (L${s.line})`).join("\n") || "(sin símbolos detectados)";
          } else {
            rec.symbolsContext = "(Abre un archivo para extraer símbolos con @symbols)";
          }
        } catch {
          rec.symbolsContext = "(Error extrayendo símbolos)";
        }
      }

      if (/@codebase\b/i.test(rawText)) {
        try {
          const cleanQ = rawText.replace(/@codebase/gi, "").trim();
          const semanticHits = semanticIndex ? semanticIndex.search(cleanQ, 6) : [];
          if (semanticHits.length > 0) {
            rec.codebaseContext = semanticHits
              .map((h) => `${h.path} [L${h.startLine}-L${h.endLine}]:\n${h.content.slice(0, 400)}`)
              .join("\n\n---\n\n");
          } else {
            const qWord = cleanQ.split(/\s+/).find((w) => w.length > 2) || "";
            const matches = qWord ? await searchWorkspace(WORKSPACE, qWord, { maxResults: 15 }) : [];
            rec.codebaseContext = matches.map((m) => `${m.path}:${m.line}: ${m.content}`).join("\n") || "(sin coincidencias clave)";
          }
        } catch {
          rec.codebaseContext = "(Búsqueda @codebase no disponible)";
        }
      }

      if (/@docs\b/i.test(rawText)) {
        rec.docsContext = "Contexto de documentación: TypeScript, Node.js v22+, ECMAScript 2024, Monaco Editor API, HTML5/CSS3.";
      }

      if (/@web\b/i.test(rawText)) {
        rec.webContext = "Búsqueda web contextual activada: APIs y especificaciones modernas.";
      }

      try {
        const result = await rec.agent.send(rawText, (ev) => {
          if (ev.type === "text") send({ type: "delta", text: ev.text });
          if (ev.type === "status") send({ type: "status", text: ev.text });
          if (ev.type === "error") send({ type: "error", message: ev.error });
          if (ev.type === "meta") streamMeta = { ...streamMeta, ...ev };
        }, mode);

        const durationMs = Date.now() - startTime;

        // In autonomous mode, automatically apply proposed edits to disk with checkpoint snapshot!
        if (mode === "autonomous" && result.edits && result.edits.length > 0) {
          await createCheckpoint(result.edits.map((e) => e.path));
          for (const edit of result.edits) {
            try {
              await acceptEdit(edit, filesPort);
            } catch (err) {
              console.error("Auto accept failed:", err);
            }
          }
        }

        send({
          type: "done",
          text: result.text,
          provider: result.provider,
          mode,
          edits: result.edits,
          plannedEdits: result.plannedEdits,
          durationMs,
          usage: streamMeta.usage,
          rateLimit: streamMeta.rateLimit,
        });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
        send({
          type: "done",
          text: "",
          provider: rec.dispatcher.getSelected(),
          edits: [],
          mode,
          durationMs: Date.now() - startTime,
        });
      }
      res.end();
      return;
    }

    // Accept Edit (Issue #9 & #13 & #15)
    if (req.method === "POST" && url.pathname === "/api/edit/accept") {
      const body = await readBody(req);
      if (body.edit?.path) {
        await createCheckpoint([body.edit.path]);
      }
      await acceptEdit(body.edit, filesPort);
      json(res, 200, { ok: true });
      return;
    }

    // Projects API
    if (req.method === "GET" && url.pathname === "/api/projects") {
      const projects = await readProjects();
      json(res, 200, { projects });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/projects") {
      const body = await readBody(req);
      const projects = await readProjects();
      const existingIdx = projects.findIndex((p) => p.id === body.id);
      const project = {
        id: body.id || ("proj-" + Date.now()),
        name: String(body.name || "Nuevo Proyecto").trim(),
        description: String(body.description || "").trim(),
        instructions: String(body.instructions || "").trim(),
        updatedAt: Date.now(),
        createdAt: body.createdAt || Date.now(),
      };
      if (existingIdx >= 0) {
        projects[existingIdx] = project;
      } else {
        projects.push(project);
      }
      await writeProjects(projects);
      json(res, 200, { ok: true, project });
      return;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/projects/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/projects/".length));
      let projects = await readProjects();
      projects = projects.filter((p) => p.id !== id);
      await writeProjects(projects);
      json(res, 200, { ok: true });
      return;
    }

    // File System Create (New File / New Folder)
    if (req.method === "POST" && url.pathname === "/api/fs/create") {
      const body = await readBody(req);
      const rel = String(body.path || "").trim();
      const isDir = !!body.isDir;
      if (!rel) {
        json(res, 400, { error: "path is required" });
        return;
      }
      const abs = safeResolve(WORKSPACE, rel);
      if (isDir) {
        await fs.mkdir(abs, { recursive: true });
      } else {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        if (!fssync.existsSync(abs)) {
          await fs.writeFile(abs, "", "utf8");
        }
      }
      json(res, 200, { ok: true, path: toPosix(path.relative(WORKSPACE, abs)) });
      return;
    }

    // Rules API (Issue #20)
    if (req.method === "GET" && url.pathname === "/api/rules") {
      const rules = await discoverRules({ workspaceRoot: WORKSPACE, home: os.homedir() });
      json(res, 200, rules);
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/rules") {
      const body = await readBody(req);
      const isGlobal = !!body.isGlobal;
      const targetFile = isGlobal
        ? path.join(os.homedir(), ".config", "fh-code", "rules.md")
        : safeResolve(WORKSPACE, String(body.file || ".cursorrules"));
      await fs.mkdir(path.dirname(targetFile), { recursive: true });
      await fs.writeFile(targetFile, String(body.content ?? ""), "utf8");
      json(res, 200, { ok: true, file: isGlobal ? "~/.config/fh-code/rules.md" : path.relative(WORKSPACE, targetFile) });
      return;
    }

    // Inline Edit API (Issue #16 - Ctrl+K)
    if (req.method === "POST" && url.pathname === "/api/inline-edit") {
      const body = await readBody(req);
      const prompt = String(body.prompt || "").trim();
      const code = String(body.code ?? "");
      const filePath = String(body.path || "");
      const lang = String(body.language || "typescript");
      const fullContent = String(body.fullContent || "");

      const instruction = [
        `File: ${filePath} (${lang})`,
        `Selected Code:`,
        `\`\`\`${lang}`,
        code,
        `\`\`\``,
        fullContent ? `Surrounding Context (first 1000 chars):\n${fullContent.slice(0, 1000)}` : "",
        `User Instruction: ${prompt}`,
        `TASK: Provide ONLY the replacement code for the selected block. Do NOT include markdown formatting or commentary outside the codeblock.`,
      ].filter(Boolean).join("\n\n");

      const rec = sessionFor("inline-edit-" + Date.now(), body.provider, body.model);
      try {
        const text = await rec.dispatcher.chat([
          { role: "system", content: "You are an expert coding assistant for inline code transforms. Return ONLY the replacement code inside a single ``` codeblock." },
          { role: "user", content: instruction },
        ]);
        const match = text.match(/```(?:\w+)?\n([\s\S]*?)```/);
        const replacement = match ? match[1] : text.trim();
        json(res, 200, { ok: true, replacement, original: code });
      } catch (err) {
        json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // Composer & Multi-file Checkpoints API (Issue #15 - Ctrl+I)
    if (req.method === "GET" && url.pathname === "/api/composer/checkpoints") {
      json(res, 200, { checkpoints: checkpoints.map(c => ({ id: c.id, timestamp: c.timestamp, filesCount: Object.keys(c.files).length })) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/composer/checkpoint") {
      const body = await readBody(req);
      const paths = Array.isArray(body.paths) ? body.paths : [];
      const cp = await createCheckpoint(paths);
      json(res, 200, { ok: true, checkpoint: { id: cp.id, timestamp: cp.timestamp } });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/composer/rollback") {
      const body = await readBody(req);
      const ok = await rollbackCheckpoint(body.id);
      json(res, 200, { ok });
      return;
    }

    // Autocomplete API (Issue #19 - Cursor Tab)
    if (req.method === "POST" && url.pathname === "/api/autocomplete") {
      const body = await readBody(req);
      const prefix = String(body.prefix || "");
      const suffix = String(body.suffix || "");
      const lang = String(body.language || "plaintext");

      if (!prefix.trim()) {
        json(res, 200, { ok: true, completion: "" });
        return;
      }

      const prompt = [
        `You are a fast predictive inline code completion engine (Cursor Tab).`,
        `Language: ${lang}`,
        `Code before cursor:`,
        prefix.slice(-700),
        suffix ? `Code after cursor:\n${suffix.slice(0, 250)}` : "",
        `Output ONLY the next logical code snippet to insert at the cursor. Do NOT repeat code before cursor. Do NOT use markdown codeblocks.`,
      ].filter(Boolean).join("\n\n");

      const rec = sessionFor("autocomplete-tab", body.provider, body.model);
      try {
        const text = await rec.dispatcher.chat([
          { role: "system", content: "You are an inline code completer. Output strictly the code to insert at cursor, nothing else." },
          { role: "user", content: prompt },
        ]);
        const clean = text.replace(/^```(?:\w+)?\n?/, "").replace(/\n?```$/, "");
        json(res, 200, { ok: true, completion: clean });
      } catch {
        json(res, 200, { ok: true, completion: "" });
      }
      return;
    }

    // Semantic Index API (Issue #17 - @codebase)
    if (req.method === "GET" && url.pathname === "/api/index/status") {
      json(res, 200, semanticIndex ? semanticIndex.getStatus() : { status: "ready", progress: "100%" });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/index/search") {
      const body = await readBody(req);
      const results = semanticIndex ? semanticIndex.search(String(body.query || ""), Number(body.topK || 8)) : [];
      json(res, 200, { results });
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
