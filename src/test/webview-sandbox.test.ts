import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";

test("webview script evaluates in a browser-like sandbox without Node require", () => {
  const repoRoot = path.join(__dirname, "..", "..");
  const code = fs.readFileSync(path.join(repoRoot, "media", "main.js"), "utf8");
  assert.equal(/\brequire\s*\(/.test(code), false);
  assert.equal(/\bmodule\.exports\b/.test(code), false);

  const fakeNode = (tag: string) => {
    const node: Record<string, unknown> = {
      tag,
      className: "",
      textContent: "",
      innerHTML: "",
      children: [] as unknown[],
      style: {},
      value: tag === "select" ? "grok" : "",
      addEventListener: () => undefined,
      appendChild(child: unknown) {
        (node.children as unknown[]).push(child);
        return child;
      },
      setAttribute: () => undefined,
    };
    return node;
  };

  const app = fakeNode("div");
  const window: Record<string, unknown> = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const document = {
    readyState: "complete",
    getElementById: (id: string) => (id === "app" ? app : null),
    createElement: (tag: string) => fakeNode(tag),
    addEventListener: () => undefined,
    body: fakeNode("body"),
  };

  const sandbox = {
    window,
    globalThis: window,
    document,
    acquireVsCodeApi: () => ({
      postMessage: () => undefined,
      getState: () => ({}),
      setState: () => undefined,
    }),
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "main.js" });

  const api = (window as { __FH_IA__?: { ready: boolean; version: string; mount: unknown } }).__FH_IA__;
  assert.ok(api, "expected window.__FH_IA__");
  assert.equal(api.ready, true);
  assert.equal(typeof api.mount, "function");
  assert.equal(api.version, "0.1.0");
});
