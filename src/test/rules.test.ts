import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { discoverRules, renderRulesForPrompt } from "../workspace/rules";

describe("rules discovery and injection (Issue #20)", () => {
  it("discovers .cursorrules and renders instructions for prompt", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "fh-rules-test-"));
    try {
      await fs.writeFile(path.join(tmp, ".cursorrules"), "Never use console.log in production.");
      const rules = await discoverRules({ workspaceRoot: tmp });
      assert.equal(rules.workspaceRules.length, 1);
      assert.equal(rules.workspaceRules[0].file, ".cursorrules");
      assert.ok(rules.combined.includes("Never use console.log"));

      const rendered = renderRulesForPrompt(rules);
      assert.ok(rendered.includes("# Instrucciones y Reglas de Codificación"));
      assert.ok(rendered.includes("Never use console.log"));
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("discovers .fhrules and multiple project rule files", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "fh-rules-test-"));
    try {
      await fs.writeFile(path.join(tmp, ".fhrules"), "Use TypeScript strict mode.");
      await fs.writeFile(path.join(tmp, "AGENTS.md"), "Write clean functions.");
      const rules = await discoverRules({ workspaceRoot: tmp });
      assert.equal(rules.workspaceRules.length, 2);
      assert.ok(rules.combined.includes("TypeScript strict mode"));
      assert.ok(rules.combined.includes("Write clean functions"));
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
