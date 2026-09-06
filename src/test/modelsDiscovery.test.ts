import assert from "node:assert/strict";
import test from "node:test";
import { fetchModelsForProvider, sortOpenAiModels } from "../modelsDiscovery";

test("sortOpenAiModels prioritizes chat/reasoning models", () => {
  const input = ["text-embedding-3-small", "whisper-1", "gpt-4o", "dall-e-3", "o3-mini", "babbage-002"];
  const sorted = sortOpenAiModels(input);
  assert.equal(sorted[0], "gpt-4o");
  assert.equal(sorted[1], "o3-mini");
  assert.ok(sorted.indexOf("whisper-1") > sorted.indexOf("o3-mini"));
  assert.ok(sorted.indexOf("text-embedding-3-small") > sorted.indexOf("o3-mini"));
});

test("fetchModelsForProvider falls back to catalog gracefully when missing key", async () => {
  const res = await fetchModelsForProvider("openai", {});
  assert.equal(res.ok, false);
  assert.equal(res.source, "catalog");
  assert.ok(res.models.includes("gpt-4o"));
  assert.ok(res.error?.includes("Sin clave"));
});

test("fetchModelsForProvider falls back to catalog on network error", async () => {
  const res = await fetchModelsForProvider("fcc", { baseUrl: "http://127.0.0.1:59999" }, 300);
  assert.equal(res.ok, false);
  assert.equal(res.source, "catalog");
  assert.ok(res.models.includes("claude-sonnet-4-20250514"));
});
