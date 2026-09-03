"use strict";

const path = require("node:path");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "out",
  "dist",
  "coverage",
  ".cache",
  ".vscode-test",
]);

function safeResolve(root, rel) {
  const raw = String(rel || ".");
  if (path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) {
    throw new Error("path outside workspace");
  }
  const base = path.resolve(root);
  const cleaned = raw.replace(/\\/g, "/");
  const target = path.resolve(base, cleaned);
  const relTo = path.relative(base, target);
  if (relTo.startsWith("..") || path.isAbsolute(relTo)) {
    throw new Error("path outside workspace");
  }
  return target;
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

module.exports = { SKIP_DIRS, safeResolve, toPosix };
