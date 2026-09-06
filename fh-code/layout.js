"use strict";

/**
 * Layout rules for fh-code chrome. Used by the desktop UI and by tests.
 * Explorer, editor, and chat stay present at every width; chat is never display:none.
 */
function layoutForWidth(width) {
  const w = Number(width);
  const narrow = w < 980;
  const compact = w < 1200;
  return {
    width: w,
    narrow,
    compact,
    explorer: true,
    editor: true,
    chat: true,
    chatDisplay: "flex",
    columns: narrow
      ? "minmax(130px, 20vw) minmax(160px, 1fr) minmax(180px, 28vw)"
      : compact
        ? "220px minmax(0, 1fr) 300px"
        : "240px minmax(0, 1fr) 340px",
  };
}

function cssHidesChat(cssText) {
  return /\.chat\s*\{[^}]*\bdisplay\s*:\s*none\b/i.test(String(cssText));
}

const api = { layoutForWidth, cssHidesChat };
if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
if (typeof globalThis !== "undefined") {
  globalThis.FhCodeLayout = api;
}
