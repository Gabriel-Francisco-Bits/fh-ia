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
