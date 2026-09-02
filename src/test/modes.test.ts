import assert from "node:assert/strict";
import { test } from "node:test";
import { isAgentMode, systemPromptForMode } from "../agent/modes";

test("ask/plan/autonomous are the supported agent modes", () => {
  assert.equal(isAgentMode("ask"), true);
  assert.equal(isAgentMode("plan"), true);
  assert.equal(isAgentMode("autonomous"), true);
  assert.equal(isAgentMode("bypass"), false);
});

test("plan prompt forbids file edits; autonomous applies them", () => {
  const plan = systemPromptForMode("plan", "BASE");
  assert.match(plan, /PLAN mode/);
  assert.match(plan, /Do not emit propose_edit/);
  const auto = systemPromptForMode("autonomous", "BASE");
  assert.match(auto, /AUTONOMOUS mode/);
  assert.match(auto, /applied automatically/);
  const ask = systemPromptForMode("ask", "BASE");
  assert.match(ask, /ASK mode/);
  assert.match(ask, /Accept or Reject/);
});
