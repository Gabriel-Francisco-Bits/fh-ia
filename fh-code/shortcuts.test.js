"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("index.html includes shortcuts modal, search and button shortcut hints", () => {
  const html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
  assert.match(html, /id="shortcuts-modal"/);
  assert.match(html, /id="shortcuts-search-input"/);
  assert.match(html, /id="shortcuts-body"/);
  assert.match(html, /id="btn-shortcuts-close"/);
  assert.match(html, /id="btn-shortcuts-ok"/);
  assert.match(html, /id="btn-new-file"[^>]*title="[^"]*Ctrl\+N/);
});

test("app.css includes keyboard shortcuts styling and kbd badges", () => {
  const css = fs.readFileSync(path.join(__dirname, "public", "app.css"), "utf8");
  assert.match(css, /\.shortcuts-dialog/);
  assert.match(css, /\.shortcuts-header/);
  assert.match(css, /\.shortcut-row/);
  assert.match(css, /\.shortcut-keys/);
  assert.match(css, /\.shortcut-keys kbd/);
});

test("app.js defines VS Code shortcuts, Monaco commands, and tab navigation", () => {
  const js = fs.readFileSync(path.join(__dirname, "public", "app.js"), "utf8");

  // Essential functions
  assert.match(js, /function registerMonacoCommands/);
  assert.match(js, /function saveAll/);
  assert.match(js, /function closeAllTabs/);
  assert.match(js, /function nextTab/);
  assert.match(js, /function prevTab/);
  assert.match(js, /function createNewFile/);
  assert.match(js, /function createNewFolder/);
  assert.match(js, /function collapseAllFolders/);
  assert.match(js, /function zoomIn/);
  assert.match(js, /function zoomOut/);
  assert.match(js, /function resetZoom/);
  assert.match(js, /function showShortcutsModal/);

  // Command palette includes VS Code shortcuts
  assert.match(js, /id:\s*"command-palette"/);
  assert.match(js, /id:\s*"new-file"/);
  assert.match(js, /id:\s*"save-all"/);
  assert.match(js, /id:\s*"close-all-tabs"/);
  assert.match(js, /id:\s*"format-doc"/);
  assert.match(js, /id:\s*"shortcuts"/);

  // Global keydown covers VS Code keys
  assert.match(js, /ev\.key === "F1"/);
  assert.match(js, /ev\.key === "F2"/);
  assert.match(js, /ev\.key === "F8"/);
  assert.match(js, /ev\.key === "F12"/);
  assert.match(js, /k === "ñ"/); // Spanish terminal shortcut
  assert.match(js, /k === "j" \|\| k === "J"/); // Toggle bottom panel
  assert.match(js, /k === "n" \|\| k === "N"/); // New file
  assert.match(js, /k === "o" \|\| k === "O"/); // Open folder
  assert.match(js, /k === "Tab" \|\| k === "PageDown"/); // Tab navigation
});

test("app.css and app.js include tool calls and reasoning UI components (Issue #21)", () => {
  const css = fs.readFileSync(path.join(__dirname, "public", "app.css"), "utf8");
  assert.match(css, /\.tool-calls-container/);
  assert.match(css, /\.tool-call-card/);
  assert.match(css, /\.tool-call-header/);
  assert.match(css, /\.tool-call-badge\.running/);
  assert.match(css, /\.tool-call-output-details/);
  assert.match(css, /\.thought-card/);

  const js = fs.readFileSync(path.join(__dirname, "public", "app.js"), "utf8");
  assert.match(js, /tool_call_start/);
  assert.match(js, /tool_call_output/);
  assert.match(js, /thought-card/);
  assert.match(js, /tool-calls-container/);
});
