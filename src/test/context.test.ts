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
