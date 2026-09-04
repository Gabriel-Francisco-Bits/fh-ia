"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { SKIP_DIRS, toPosix } = require("./paths");

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "ico", "svg", "webp", "pdf", "zip", "tar", "gz",
  "vsix", "deb", "exe", "dmg", "bin", "node", "woff", "woff2", "ttf", "eot",
]);

class SemanticIndex {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.chunks = []; // { path, startLine, endLine, content, tokens }
    this.status = "idle";
    this.progress = 0;
    this.indexedFiles = 0;
    this.totalFiles = 0;
  }

  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s$]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  async buildIndex() {
    this.status = "indexing";
    this.chunks = [];
    const filesToScan = [];

    async function walk(dir) {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const name = ent.name;
        if (
          SKIP_DIRS.has(name) ||
          (name.startsWith(".") && ![".github", ".claude", ".grok", ".agents", ".cursor"].includes(name))
        ) {
          continue;
        }
        const full = path.join(dir, name);
        if (ent.isDirectory()) {
          await walk(full);
        } else if (ent.isFile()) {
          const ext = (name.split(".").pop() || "").toLowerCase();
          if (!BINARY_EXTENSIONS.has(ext)) {
            filesToScan.push(full);
          }
        }
      }
    }

    await walk(this.workspaceRoot);
    this.totalFiles = filesToScan.length;
    this.indexedFiles = 0;

    for (const file of filesToScan) {
      try {
        const content = await fs.readFile(file, "utf8");
        const rel = toPosix(path.relative(this.workspaceRoot, file));
        const lines = content.split(/\r?\n/);
        const chunkSize = 40;
        const overlap = 10;

        for (let i = 0; i < lines.length; i += (chunkSize - overlap)) {
          const chunkLines = lines.slice(i, i + chunkSize);
          if (!chunkLines.some((l) => l.trim().length > 0)) continue;
          const chunkText = chunkLines.join("\n");
          this.chunks.push({
            path: rel,
            startLine: i + 1,
            endLine: Math.min(i + chunkSize, lines.length),
            content: chunkText,
            tokens: new Set(this.tokenize(chunkText)),
          });
        }
      } catch {
        // ignore read errors
      }
      this.indexedFiles++;
      this.progress = Math.round((this.indexedFiles / Math.max(1, this.totalFiles)) * 100);
    }

    this.status = "ready";
  }

  search(query, topK = 8) {
    const qTokens = this.tokenize(query);
    if (!qTokens.length || !this.chunks.length) return [];

    const scored = [];
    for (const chunk of this.chunks) {
      let score = 0;
      for (const qt of qTokens) {
        if (chunk.tokens.has(qt)) {
          score += 2;
        }
        if (chunk.path.toLowerCase().includes(qt)) {
          score += 3;
        }
      }
      if (score > 0) {
        scored.push({ ...chunk, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  getStatus() {
    return {
      status: this.status,
      progress: `${this.progress}%`,
      files: this.indexedFiles,
      totalFiles: this.totalFiles,
      chunks: this.chunks.length,
    };
  }
}

module.exports = {
  SemanticIndex,
};
