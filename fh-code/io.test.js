"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-code-io-"));
fs.writeFileSync(path.join(dir, "hello.ts"), "export const n = 1;\n");
process.env.FH_IA_WORKSPACE = dir;

const { startServer } = require("./server");

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

test("shipped server opens and saves a workspace file", async (t) => {
  const { server, port } = await startServer(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const opened = await request(port, "GET", "/api/file?path=hello.ts");
  assert.equal(opened.status, 200);
  assert.equal(opened.body.content, "export const n = 1;\n");
  const saved = await request(port, "PUT", "/api/file", { path: "hello.ts", content: "export const n = 2;\n" });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.ok, true);
  assert.equal(fs.readFileSync(path.join(dir, "hello.ts"), "utf8"), "export const n = 2;\n");
  const meta = await request(port, "GET", "/api/meta");
  assert.ok(meta.body.name);
  assert.ok(meta.body.models.claude);
  assert.ok(meta.body.models.grok);
  assert.ok(meta.body.models.openai);
  assert.ok(meta.body.models.fcc);
});
