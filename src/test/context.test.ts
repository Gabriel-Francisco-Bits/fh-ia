import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AgentSession } from "../agent/session";
import { ProviderDispatcher } from "../providers/dispatcher";
import type { EditorPort } from "../workspace/context";
import { createNodeFilePort, type FilePort } from "../workspace/files";
import { startSseServer } from "./helpers";

test("outbound prompt payload includes active file path and selected span", async () => {
  const grok = await startSseServer({ kind: "openai", pathSuffix: "/v1/chat/completions", reply: "ok" });
  try {

  const editor: EditorPort = {
    activeFile: {
      path: "src/app.ts",
      content: "export function greet() { return 'hi'; }\n",
    },
    selection: {
      path: "src/app.ts",
      text: "function greet",
      startLine: 1,
      endLine: 1,
    },
  };
  const files: FilePort = {
    async read() {
      throw new Error("not used");
    },
    async write() {
      throw new Error("not used");
    },
    async exists() {
      return false;
    },
  };

  const dispatcher = new ProviderDispatcher({
    bundle: {
      selected: "grok",
      claude: { id: "claude", apiKey: "unused", baseUrl: "http://127.0.0.1:9", model: "x" },
      grok: { id: "grok", apiKey: "xai-test", baseUrl: grok.url, model: "grok-test" },
      openai: { id: "openai", apiKey: "unused", baseUrl: "http://127.0.0.1:9", model: "x" },
      fcc: { id: "fcc", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "x" },
      minimax: { id: "minimax", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "x" },
    },
  });

  const session = new AgentSession(dispatcher, files, () => editor);
  await session.send("explain this selection", () => undefined);

  assert.equal(grok.requests.length, 1);
  const body = grok.requests[0].body;
  assert.match(body, /src\/app\.ts/);
  assert.match(body, /function greet/);
  assert.match(body, /explain this selection/);
  assert.match(body, /L1-L1/);
  } finally {
    await grok.close();
  }
});

test("contextual mentions (@git, @terminal, @symbols) are attached into outbound payload", async () => {
  const grok = await startSseServer({ kind: "openai", pathSuffix: "/v1/chat/completions", reply: "ok" });
  try {
    const editor: EditorPort = {
      workspaceRoot: "/test/repo",
      gitContext: "Branch: main\nModified: src/index.ts",
      terminalContext: "npm test: 50 passed",
      symbolsContext: "function run() (L10)",
    };
    const files: FilePort = {
      async read() { throw new Error("not used"); },
      async write() { throw new Error("not used"); },
      async exists() { return false; },
    };
    const dispatcher = new ProviderDispatcher({
      bundle: {
        selected: "grok",
        claude: { id: "claude", apiKey: "unused", baseUrl: "http://127.0.0.1:9", model: "x" },
        grok: { id: "grok", apiKey: "xai-test", baseUrl: grok.url, model: "grok-test" },
        openai: { id: "openai", apiKey: "unused", baseUrl: "http://127.0.0.1:9", model: "x" },
        fcc: { id: "fcc", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "x" },
        minimax: { id: "minimax", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "x" },
      },
    });
    const session = new AgentSession(dispatcher, files, () => editor);
    await session.send("review @git and @terminal and @symbols", () => undefined);

    assert.equal(grok.requests.length, 1);
    const body = grok.requests[0].body;
    assert.match(body, /Git Status & Diff/);
    assert.match(body, /Terminal Buffer Output/);
    assert.match(body, /Code Symbols/);
    assert.match(body, /npm test: 50 passed/);
  } finally {
    await grok.close();
  }
});

test("@file mention is attached into the outbound payload", async () => {
  const grok = await startSseServer({ kind: "openai", pathSuffix: "/v1/chat/completions", reply: "ok" });
  try {

  const files: FilePort = {
    async read(p) {
      if (p === "lib/util.ts") {
        return "export const MAGIC = 42;\n";
      }
      throw new Error("missing " + p);
    },
    async write() {
      throw new Error("not used");
    },
    async exists() {
      return true;
    },
  };

  const dispatcher = new ProviderDispatcher({
    bundle: {
      selected: "grok",
      claude: { id: "claude", apiKey: "unused", baseUrl: "http://127.0.0.1:9", model: "x" },
      grok: { id: "grok", apiKey: "xai-test", baseUrl: grok.url, model: "grok-test" },
      openai: { id: "openai", apiKey: "unused", baseUrl: "http://127.0.0.1:9", model: "x" },
      fcc: { id: "fcc", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "x" },
      minimax: { id: "minimax", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "x" },
    },
  });

  const session = new AgentSession(dispatcher, files, () => ({}));
  await session.send("look at @lib/util.ts", () => undefined);
  assert.match(grok.requests[0].body, /lib\/util\.ts/);
  assert.match(grok.requests[0].body, /MAGIC = 42/);
  } finally {
    await grok.close();
  }
});

test("open folder and repo tree are sent even without an active file", async () => {
  const grok = await startSseServer({ kind: "openai", pathSuffix: "/v1/chat/completions", reply: "ok" });
  try {
    const files: FilePort = {
      async read() {
        throw new Error("not used");
      },
      async write() {
        throw new Error("not used");
      },
      async exists() {
        return false;
      },
      async list() {
        return ["README.md", "src/", "src/extension.ts", "package.json"];
      },
    };
    const dispatcher = new ProviderDispatcher({
      bundle: {
        selected: "grok",
        claude: { id: "claude", apiKey: "unused", baseUrl: "http://127.0.0.1:9", model: "x" },
        grok: { id: "grok", apiKey: "xai-test", baseUrl: grok.url, model: "grok-test" },
        openai: { id: "openai", apiKey: "unused", baseUrl: "http://127.0.0.1:9", model: "x" },
        fcc: { id: "fcc", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "x" },
        minimax: { id: "minimax", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "x" },
      },
    });
    const session = new AgentSession(dispatcher, files, () => ({
      workspaceRoot: "/home/gfh/Downloads/fh-ia",
      openFiles: ["README.md"],
    }));
    await session.send("ves el repo", () => undefined);
    const body = grok.requests[0].body;
    assert.match(body, /Open folder: fh-ia/);
    assert.match(body, /src\/extension\.ts/);
    assert.match(body, /package\.json/);
    assert.match(body, /ves el repo/);
    assert.match(body, /you CAN see the repo/i);
  } finally {
    await grok.close();
  }
});

test("node file port lists workspace files and skips node_modules", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fh-ia-tree-"));
  await mkdir(path.join(dir, "src"));
  await mkdir(path.join(dir, "node_modules", "pkg"), { recursive: true });
  await writeFile(path.join(dir, "README.md"), "# hi\n", "utf8");
  await writeFile(path.join(dir, "src", "app.ts"), "export {}\n", "utf8");
  await writeFile(path.join(dir, "node_modules", "pkg", "index.js"), "1\n", "utf8");
  const tree = await createNodeFilePort(dir).list?.(200);
  assert.ok(tree?.includes("README.md"));
  assert.ok(tree?.includes("src/"));
  assert.ok(tree?.includes("src/app.ts"));
  assert.equal(tree?.some((p) => p.includes("node_modules")), false);
});

test("extractSymbolsFromCode extracts functions, classes, interfaces, types, and enums with signatures (Issue #24)", () => {
  const { extractSymbolsFromCode } = require("../workspace/context");
  const code = `
export function computeTotal(price: number, tax: number): number {
  return price + tax;
}

export const formatCurrency = (val: number): string => "$" + val;

export class PaymentProcessor extends BaseProcessor implements IPayment {
  process() {}
}

export interface IPayment {
  id: string;
}

export type PaymentStatus = "pending" | "completed" | "failed";

export enum Currency {
  USD = "USD",
  EUR = "EUR"
}
`;
  const symbols = extractSymbolsFromCode(code);
  assert.ok(symbols.length >= 6);

  const fn1 = symbols.find((s: any) => s.name === "computeTotal");
  assert.ok(fn1 && fn1.kind === "function");
  assert.match(fn1.signature, /function computeTotal\(price: number, tax: number\): number/);

  const fn2 = symbols.find((s: any) => s.name === "formatCurrency");
  assert.ok(fn2 && fn2.kind === "function");

  const cls = symbols.find((s: any) => s.name === "PaymentProcessor");
  assert.ok(cls && cls.kind === "class");
  assert.match(cls.signature, /class PaymentProcessor extends BaseProcessor implements IPayment/);

  const iface = symbols.find((s: any) => s.name === "IPayment");
  assert.ok(iface && iface.kind === "interface");

  const tp = symbols.find((s: any) => s.name === "PaymentStatus");
  assert.ok(tp && tp.kind === "type");

  const en = symbols.find((s: any) => s.name === "Currency");
  assert.ok(en && en.kind === "enum");
});

test("resolveImportedSymbols resolves signatures from imported local files (Issue #24)", async () => {
  const { resolveImportedSymbols, buildCodeIntelligenceContext } = require("../workspace/context");

  const filesMap: Record<string, string> = {
    "src/math/calc.ts": `
export function multiply(a: number, b: number): number { return a * b; }
export interface CalcOptions { precision: number; }
`,
  };

  const dummyFiles: FilePort = {
    async read(p: string) {
      if (filesMap[p]) return filesMap[p];
      throw new Error("File not found: " + p);
    },
    async write() { throw new Error("not used"); },
    async exists(p: string) { return Boolean(filesMap[p]); },
  };

  const activeContent = `
import { multiply } from "./math/calc";

export function runCalculation() {
  return multiply(2, 3);
}
`;
  const resolved = await resolveImportedSymbols("src/app.ts", activeContent, dummyFiles);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].moduleSpecifier, "./math/calc");
  assert.ok(resolved[0].exportedSymbols.some((s: any) => s.name === "multiply"));
  assert.ok(resolved[0].exportedSymbols.some((s: any) => s.name === "CalcOptions"));

  const summary = await buildCodeIntelligenceContext(
    { path: "src/app.ts", content: activeContent },
    dummyFiles,
  );
  assert.match(summary, /Symbols in src\/app\.ts/);
  assert.match(summary, /Imported Module Signatures & Types/);
  assert.match(summary, /multiply/);
});

test("gatherContext integrates @docs and code intelligence automatically (Issue #24)", async () => {
  const { gatherContext, renderContextBlock } = require("../workspace/context");

  const filesMap: Record<string, string> = {
    "src/helper.ts": "export function helpUser() { return 'helped'; }",
  };
  const dummyFiles: FilePort = {
    async read(p: string) { return filesMap[p] || ""; },
    async write() { throw new Error("not used"); },
    async exists(p: string) { return Boolean(filesMap[p]); },
  };

  const editor: EditorPort = {
    activeFile: {
      path: "src/main.ts",
      content: 'import { helpUser } from "./helper";\nexport class AppRunner {}\n',
    },
  };

  const ctx = await gatherContext("how do I run @docs and check @symbols?", editor, dummyFiles);
  assert.ok(ctx.docsContext, "Should generate docsContext when @docs is mentioned");
  assert.match(ctx.docsContext!, /Framework Documentation/);
  assert.ok(ctx.symbolsContext, "Should auto-generate symbolsContext with AST intelligence");
  assert.match(ctx.symbolsContext!, /AppRunner/);
  assert.match(ctx.symbolsContext!, /helpUser/);

  const block = renderContextBlock(ctx);
  assert.match(block, /Framework Documentation Context \(@docs\)/);
  assert.match(block, /Code Symbols \(@symbols\)/);
});
