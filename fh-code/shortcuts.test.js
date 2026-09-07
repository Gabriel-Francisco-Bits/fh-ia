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

test("app.js has valid JavaScript syntax without parse or declaration errors", () => {
  const jsPath = path.join(__dirname, "public", "app.js");
  const js = fs.readFileSync(jsPath, "utf8");
  assert.doesNotThrow(() => {
    new Function(js);
  });
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

test("app.css, app.js and index.html include surgical diffs, monaco preview and hunk shortcuts (Issue #23)", () => {
  const html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
  assert.match(html, /id="diff-editor-toolbar"/);
  assert.match(html, /id="btn-diff-toggle-split"/);
  assert.match(html, /id="btn-diff-accept-all"/);
  assert.match(html, /id="btn-diff-reject-all"/);
  assert.match(html, /id="btn-diff-close"/);

  const css = fs.readFileSync(path.join(__dirname, "public", "app.css"), "utf8");
  assert.match(css, /\.diff-delete-line/);
  assert.match(css, /\.diff-add-line/);
  assert.match(css, /\.diff-delete-gutter/);
  assert.match(css, /\.diff-add-gutter/);
  assert.match(css, /\.diff-hunk-widget/);
  assert.match(css, /\.diff-editor-toolbar/);

  const js = fs.readFileSync(path.join(__dirname, "public", "app.js"), "utf8");
  assert.match(js, /monaco\.editor\.createDiffEditor/);
  assert.match(js, /applyInlineHunkDecorations/);
  assert.match(js, /acceptSingleHunk/);
  assert.match(js, /rejectSingleHunk/);
  assert.match(js, /monaco\.KeyCode\.Backspace/);
});

test("app.css, app.js and index.html include contextual mentions UI (Issue #24)", () => {
  const html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
  assert.match(html, /id="mention-menu"/);
  assert.match(html, /id="mention-menu-list"/);

  const css = fs.readFileSync(path.join(__dirname, "public", "app.css"), "utf8");
  assert.match(css, /\.mention-menu/);
  assert.match(css, /\.mention-item/);
  assert.match(css, /\.mention-item-tag/);

  const js = fs.readFileSync(path.join(__dirname, "public", "app.js"), "utf8");
  assert.match(js, /@codebase/);
  assert.match(js, /@symbols/);
  assert.match(js, /@git/);
  assert.match(js, /@terminal/);
  assert.match(js, /@docs/);
  assert.match(js, /function applyMention/);
  assert.match(js, /function handleMentionInput/);
});

test("app.css, app.js and index.html include message queue, minimax provider and enhanced thinking animation (Issue #35)", () => {
  const html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
  assert.match(html, /id="chat-queue-bar"/);
  assert.match(html, /id="btn-clear-queue"/);
  assert.match(html, /id="card-provider-minimax"/);
  assert.match(html, /id="drawer-minimax"/);
  assert.match(html, /id="set-minimax-cookie"/);
  assert.match(html, /id="status-pill-minimax"/);
  assert.match(html, /<option value="minimax">/);

  const css = fs.readFileSync(path.join(__dirname, "public", "app.css"), "utf8");
  assert.match(css, /#chat-queue-bar/);
  assert.match(css, /\.btn-clear-queue/);
  assert.match(css, /\.msg\.user\.queued/);
  assert.match(css, /\.btn-cancel-queue/);
  assert.match(css, /\.thinking-card/);
  assert.match(css, /\.thinking-glow-effect/);
  assert.match(css, /\.thinking-sparkle-svg/);
  assert.match(css, /\.thinking-progress-track/);
  assert.match(css, /\.thinking-progress-thumb/);
  assert.match(css, /\.typing-wave/);
  assert.match(css, /\.dot-minimax/);

  const js = fs.readFileSync(path.join(__dirname, "public", "app.js"), "utf8");
  assert.match(js, /(?:let|const)\s+messageQueue\s*=/);
  assert.match(js, /function enqueueMessage/);
  assert.match(js, /function updateQueueUI/);
  assert.match(js, /function cancelQueuedMessage/);
  assert.match(js, /function clearAllQueuedMessages/);
  assert.match(js, /minimax/);
  assert.match(js, /updateWebCookieAssistant/);
});
