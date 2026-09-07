"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { layoutForWidth, cssHidesChat } = require("./layout");

test("explorer, editor, and chat stay in the layout at 800 and 1400", () => {
  for (const width of [800, 1400]) {
    const spec = layoutForWidth(width);
    assert.equal(spec.explorer, true);
    assert.equal(spec.editor, true);
    assert.equal(spec.chat, true);
    assert.equal(spec.chatDisplay, "flex");
    assert.notEqual(spec.chatDisplay, "none");
    assert.match(spec.columns, /1fr/);
  }
});

test("shipped CSS does not hide .chat with display:none", () => {
  const css = fs.readFileSync(path.join(__dirname, "public", "app.css"), "utf8");
  assert.equal(cssHidesChat(".chat { display: none; }"), true);
  assert.equal(cssHidesChat(css), false);
  assert.equal(/\bdisplay\s*:\s*none\b/.test(css) && /\.chat[\s\S]{0,80}display\s*:\s*none/.test(css), false);
});

test("Orca-style full-width statusbar is present outside workbench and limits are not in composer", () => {
  const html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "public", "app.css"), "utf8");

  // Status bar is a full-width footer
  assert.match(html, /<footer\s+class="statusbar"\s+id="statusbar"/);
  assert.match(html, /id="statusbar-roster-pills"/);
  assert.match(html, /id="status-pill-claude"/);
  assert.match(html, /id="status-pill-openai"/);
  assert.match(html, /id="status-pill-grok"/);
  assert.match(html, /id="status-pill-fcc"/);
  assert.match(html, /id="statusbar-usage-popover"/);
  assert.match(html, /id="sb-git-branch"/);
  assert.match(html, /id="sb-active-ai"/);
  assert.match(html, /id="sb-toggle-terminal"/);

  // Limits bar is removed from inside chat composer
  assert.equal(html.includes('id="composer-limits-bar"'), false);

  // CSS defines full-width bottom status bar
  assert.match(css, /\.statusbar\s*\{/);
  assert.match(css, /\.status-provider-pill/);
  assert.match(css, /\.status-usage-bar/);
});

