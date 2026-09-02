import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

test("package.json declares vscode engine, chat view container, and open-panel command", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")) as {
    engines?: { vscode?: string };
    main?: string;
    contributes?: {
      commands?: Array<{ command: string }>;
      viewsContainers?: { activitybar?: Array<{ id: string }> };
      views?: Record<string, Array<{ id: string; type?: string }>>;
      configuration?: { properties?: Record<string, { enum?: string[] }> };
    };
  };
  assert.ok(pkg.engines?.vscode, "engines.vscode required");
  assert.ok(pkg.main?.endsWith("extension.js"));
  const commands = pkg.contributes?.commands?.map((c) => c.command) ?? [];
  assert.ok(commands.includes("fhIa.openPanel"));
  assert.ok(commands.includes("fhIa.newChat"));
  assert.ok(commands.includes("fhIa.openSettings"));
  assert.ok(commands.includes("fhIa.openInTab"));
  const containers = pkg.contributes?.viewsContainers?.activitybar ?? [];
  assert.ok(containers.some((c) => c.id === "fhIa"));
  const views = pkg.contributes?.views?.fhIa ?? [];
  assert.ok(views.some((v) => v.id === "fhIa.chatView" && v.type === "webview"));
  const providerEnum = pkg.contributes?.configuration?.properties?.["fhIa.provider"]?.enum ?? [];
  assert.ok(providerEnum.includes("claude"));
  assert.ok(providerEnum.includes("grok"));
  assert.ok(providerEnum.includes("openai"));
  const authEnum = pkg.contributes?.configuration?.properties?.["fhIa.authMode"]?.enum ?? [];
  assert.ok(authEnum.includes("auto"));
  assert.ok(authEnum.includes("apiKey"));
  assert.ok(authEnum.includes("terminal"));
  const props = pkg.contributes?.configuration?.properties ?? {};
  assert.ok(props["fhIa.failover.enabled"]);
  assert.ok(props["fhIa.failover.order"]);
  const modeEnum = props["fhIa.agentMode"]?.enum ?? [];
  assert.ok(modeEnum.includes("ask"));
  assert.ok(modeEnum.includes("plan"));
  assert.ok(modeEnum.includes("autonomous"));
});
