import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateTokens, TokenBudgetManager, type ChatMessage } from "../agent/tokenBudget";

test("estimateTokens provides realistic BPE token estimations for code and prose", () => {
  assert.equal(estimateTokens(""), 0);
  
  const shortText = "Hello world";
  const tokens = estimateTokens(shortText);
  assert.ok(tokens >= 2 && tokens <= 4, `Expected 2-4 tokens, got ${tokens}`);

  const codeSnippet = `
function calculateTax(amount: number, rate: number): number {
  return amount * rate;
}
`;
  const codeTokens = estimateTokens(codeSnippet);
  assert.ok(codeTokens >= 15 && codeTokens <= 30, `Expected 15-30 tokens, got ${codeTokens}`);
});

test("TokenBudgetManager allocates 60% code, 20% rules, and 20% history", () => {
  const manager = new TokenBudgetManager({ totalBudget: 10_000 });
  const alloc = manager.getAllocation();

  assert.equal(alloc.totalBudget, 10_000);
  assert.equal(alloc.codeBudget, 6_000); // 60%
  assert.equal(alloc.rulesBudget, 2_000); // 20%
  assert.equal(alloc.historyBudget, 2_000); // 20%
});

test("TokenBudgetManager prunes history sliding window while preserving original task turn", () => {
  const manager = new TokenBudgetManager();
  
  const history: ChatMessage[] = [
    { role: "user", content: "Original task: please refactor auth and database" },
    { role: "assistant", content: "Working on auth... " + "details ".repeat(50) },
    { role: "user", content: "Next step... " + "more details ".repeat(50) },
    { role: "assistant", content: "Done with step 2... " + "step 2 details ".repeat(50) },
    { role: "user", content: "What is the status now?" },
  ];

  // Restrict history budget to small amount of tokens
  const pruned = manager.pruneHistory(history, 80);

  // Must retain original user intent (history[0])
  assert.equal(pruned[0].role, "user");
  assert.match(pruned[0].content, /Original task/);

  // Must retain recent message at the end
  const last = pruned[pruned.length - 1];
  assert.equal(last.role, "user");
  assert.match(last.content, /What is the status now\?/);

  // Must have notice about pruned messages
  assert.ok(pruned.some((m) => m.content.includes("pruned to preserve token budget")));
});

test("TokenBudgetManager prunes code context and rules when exceeding their budgets", () => {
  const manager = new TokenBudgetManager();

  const longRules = "Rule: follow strict types.\n".repeat(100);
  const prunedRules = manager.pruneRules(longRules, 50);
  assert.ok(prunedRules.includes("Standing rules truncated to fit token budget"));

  const longContext = "[Workspace context]\n" + "file content ".repeat(200);
  const prunedContext = manager.pruneContext(longContext, 60);
  assert.ok(prunedContext.includes("Workspace code context truncated to fit 60% token budget"));
});
