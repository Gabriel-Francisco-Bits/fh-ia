"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { SKIP_DIRS, toPosix } = require("./paths");

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const MAX_MATCHES = 300;

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "ico", "svg", "webp", "pdf", "zip", "tar", "gz",
  "vsix", "deb", "exe", "dmg", "bin", "node", "woff", "woff2", "ttf", "eot",
]);

async function searchWorkspace(workspaceRoot, query, options = {}) {
  const q = String(query || "").trim();
  if (!q) return [];
  const caseSensitive = Boolean(options.caseSensitive);
  const target = caseSensitive ? q : q.toLowerCase();
  const matches = [];

  async function walk(dir) {
    if (matches.length >= MAX_MATCHES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      if (matches.length >= MAX_MATCHES) break;
      const name = ent.name;
      if (
        SKIP_DIRS.has(name) ||
        (name.startsWith(".") && ![".github", ".claude", ".grok", ".agents", ".cursor"].includes(name))
      ) {
        continue;
      }

      const fullPath = path.join(dir, name);
      if (ent.isDirectory()) {
        await walk(fullPath);
      } else if (ent.isFile()) {
        const ext = name.split(".").pop().toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) continue;

        try {
          const stat = await fs.stat(fullPath);
          if (stat.size > MAX_FILE_SIZE) continue;
          const content = await fs.readFile(fullPath, "utf8");
          const relPath = toPosix(path.relative(workspaceRoot, fullPath));

          const lines = content.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= MAX_MATCHES) break;
            const line = lines[i];
            const hay = caseSensitive ? line : line.toLowerCase();
            const col = hay.indexOf(target);
            if (col !== -1) {
              matches.push({
                path: relPath,
                line: i + 1,
                col: col + 1,
                preview: line.trim().slice(0, 150),
              });
            }
          }
        } catch {
          // ignore unreadable
        }
      }
    }
  }

  await walk(workspaceRoot);
  return matches;
}

module.exports = { searchWorkspace };
