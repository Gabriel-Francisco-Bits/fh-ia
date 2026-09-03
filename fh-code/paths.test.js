"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { safeResolve } = require("./paths");

test("safeResolve stays inside the workspace", () => {
  const root = path.join("/tmp", "ws");
  assert.equal(safeResolve(root, "src/a.ts"), path.resolve(root, "src/a.ts"));
  assert.throws(() => safeResolve(root, "../etc/passwd"));
  assert.throws(() => safeResolve(root, "/etc/passwd"));
});
