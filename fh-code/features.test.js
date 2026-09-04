"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-code-features-"));
fs.writeFileSync(path.join(dir, "searchable.js"), "function findMeNow() {\n  const secret = 'magic-string';\n  return secret;\n}\n");
fs.writeFileSync(path.join(dir, "invalid.json"), "{\n  \"bad\": 123,\n}\n");
fs.writeFileSync(path.join(dir, "valid.json"), "{\n  \"ok\": true\n}\n");

process.env.FH_IA_WORKSPACE = dir;

const { startServer } = require("./server");
const { getDiagnostics, extractSymbols } = require("./lsp");
const { searchWorkspace } = require("./search");
const { getMergedSettings, updateSettings, resetSettings } = require("./settings");
const { TerminalManager } = require("./terminal");

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: data
          ? { "content-type": "application/json", "content-length": data.length }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

test("searchWorkspace finds occurrences across files", async () => {
  const matches = await searchWorkspace(dir, "magic-string");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].path, "searchable.js");
  assert.equal(matches[0].line, 2);
  assert.match(matches[0].preview, /magic-string/);
});

test("lsp diagnostics detect json and javascript errors", async () => {
  const jsonErrors = await getDiagnostics("test.json", "{\n  \"foo\": ,\n}", "json");
  assert.ok(jsonErrors.length > 0);
  assert.equal(jsonErrors[0].severity, "error");

  const validJson = await getDiagnostics("test.json", '{"foo": 123}', "json");
  assert.equal(validJson.length, 0);

  const jsErrors = await getDiagnostics("bad.js", "function () { return; }", "javascript");
  assert.ok(jsErrors.length > 0);

  const symbols = extractSymbols("class AwesomeService {}\nfunction runTask() {}\nconst doWork = () => {};", "javascript");
  assert.equal(symbols.length, 3);
  assert.equal(symbols[0].name, "AwesomeService");
  assert.equal(symbols[1].name, "runTask");
  assert.equal(symbols[2].name, "doWork");
});

test("settings manager supports get, update, and reset", async () => {
  const init = getMergedSettings();
  assert.ok(init["fhIa.provider"]);

  const updated = await updateSettings({ "fhIa.ui.fontSize": 19, "fhIa.grok.model": "grok-custom-test" });
  assert.equal(updated["fhIa.ui.fontSize"], 19);
  assert.equal(updated["fhIa.grok.model"], "grok-custom-test");

  const reset = await resetSettings();
  assert.equal(reset["fhIa.ui.fontSize"], 15);
  assert.equal(reset["fhIa.grok.model"], "grok-4");
});

test("server provides search, settings, and lsp endpoints", async (t) => {
  const { server, port } = await startServer(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  // Search API
  const searchRes = await request(port, "GET", "/api/search?q=findMeNow");
  assert.equal(searchRes.status, 200);
  assert.equal(searchRes.body.matches.length, 1);
  assert.equal(searchRes.body.matches[0].path, "searchable.js");

  // Settings API
  const getSettings = await request(port, "GET", "/api/settings");
  assert.equal(getSettings.status, 200);
  assert.ok(getSettings.body["fhIa.provider"]);

  const putSettings = await request(port, "PUT", "/api/settings", { "fhIa.ui.theme": "dark" });
  assert.equal(putSettings.status, 200);
  assert.equal(putSettings.body.settings["fhIa.ui.theme"], "dark");

  const resetReq = await request(port, "POST", "/api/settings/reset");
  assert.equal(resetReq.status, 200);
  assert.equal(resetReq.body.settings["fhIa.ui.theme"], "auto");

  // LSP API
  const lspRes = await request(port, "POST", "/api/lsp/diagnostics", {
    path: "test.json",
    content: "{ invalid: }",
    language: "json",
  });
  assert.equal(lspRes.status, 200);
  assert.ok(lspRes.body.diagnostics.length > 0);

  // Terminal session API
  const termRes = await request(port, "POST", "/api/terminal/session", { id: "test-term" });
  assert.equal(termRes.status, 200);
  assert.equal(termRes.body.id, "test-term");

  const termInputRes = await request(port, "POST", "/api/terminal/input", { id: "test-term", input: "echo hello\n" });
  assert.equal(termInputRes.status, 200);
  assert.equal(termInputRes.body.ok, true);

  // Workspace Open API
  const newDir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-new-ws-"));
  const wsOpen = await request(port, "POST", "/api/workspace/open", { path: newDir });
  assert.equal(wsOpen.status, 200);
  assert.equal(wsOpen.body.workspace, newDir);

  const wsBad = await request(port, "POST", "/api/workspace/open", { path: "/nonexistent/random/path" });
  assert.equal(wsBad.status, 400);
});

test("terminal manager spawns session and handles I/O", async (t) => {
  const mgr = new TerminalManager();
  t.after(() => mgr.closeAll());

  const session = mgr.getOrCreate("session-1", dir);
  assert.ok(session);
  assert.equal(session.id, "session-1");

  let gotOutput = false;
  const unsub = session.subscribe((data) => {
    if (data) gotOutput = true;
  });

  session.write("echo test_output_123\n");
  await new Promise((r) => setTimeout(r, 400));
  unsub();
  assert.equal(gotOutput, true);
});
