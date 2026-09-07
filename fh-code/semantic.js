"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { SKIP_DIRS, toPosix } = require("./paths");

const MAX_FILE_SIZE_BYTES = 256 * 1024; // 256 KB safety limit against OOM

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "ico", "svg", "webp", "pdf", "zip", "tar", "gz",
  "vsix", "deb", "exe", "dmg", "bin", "node", "woff", "woff2", "ttf", "eot",
  "mp3", "mp4", "wav", "avi", "mov", "lock", "pyc", "pyo", "pyd", "so", "dylib",
  "dll", "class", "jar", "war", "ear", "db", "sqlite", "sqlite3", "o", "a",
]);

const EXTRA_SKIP_DIRS = new Set([
  ".dart_tool", "build", ".gradle", "target", "node_modules", ".git", "dist",
  "venv", ".venv", "__pycache__", "Pods", ".next", ".nuxt", ".turbo",
  "out", "coverage", ".cache", ".vscode-test", "obj", "bin", ".idea", ".vscode"
]);

class SemanticIndex {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.chunks = []; // { id, path, startLine, endLine, content, kind, name, tokens, termFreq, docLength }
    this.status = "idle";
    this.progress = 0;
    this.indexedFiles = 0;
    this.totalFiles = 0;
    this.docFreq = new Map(); // term -> count of chunks containing it
    this.avgDocLength = 0;
  }

  tokenize(text) {
    if (!text || typeof text !== "string") return [];
    // Split camelCase and snake_case into separate tokens as well
    const rawTokens = text
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[^\w\s$]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);

    return rawTokens;
  }

  computeTermFrequency(tokens) {
    const tf = new Map();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }
    return tf;
  }

  recalculateStats() {
    this.docFreq.clear();
    let totalLength = 0;

    for (const chunk of this.chunks) {
      totalLength += chunk.docLength;
      for (const term of chunk.tokens) {
        this.docFreq.set(term, (this.docFreq.get(term) || 0) + 1);
      }
    }

    this.avgDocLength = this.chunks.length > 0 ? totalLength / this.chunks.length : 1;
  }

  chunkSyntactically(content, relPath) {
    const lines = content.split(/\r?\n/);
    if (!lines.length) return [];

    const ext = path.extname(relPath).toLowerCase().replace(/^\./, "");
    const isCode = ["ts", "js", "tsx", "jsx", "py", "dart", "go", "rs", "java", "c", "cpp", "cs", "php", "rb", "swift"].includes(ext);
    const isMarkdown = ["md", "markdown", "mdx"].includes(ext);

    const chunks = [];
    let currentBlock = null;

    const finalizeBlock = (block) => {
      if (!block || !block.lines.length) return;
      const text = block.lines.join("\n");
      if (!text.trim()) return;

      const tokens = this.tokenize(text);
      if (!tokens.length) return;

      chunks.push({
        id: `${relPath}:${block.startLine}-${block.endLine}`,
        path: relPath,
        startLine: block.startLine,
        endLine: block.endLine,
        content: text,
        kind: block.kind || "block",
        name: block.name || "",
        tokens: new Set(tokens),
        termFreq: this.computeTermFrequency(tokens),
        docLength: tokens.length,
      });
    };

    if (isMarkdown) {
      // Markdown header chunking
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const headerMatch = line.match(/^(#{1,4})\s+(.+)$/);
        if (headerMatch) {
          finalizeBlock(currentBlock);
          currentBlock = {
            startLine: i + 1,
            endLine: i + 1,
            kind: "header",
            name: headerMatch[2].trim(),
            lines: [line],
          };
        } else if (currentBlock) {
          currentBlock.lines.push(line);
          currentBlock.endLine = i + 1;
          if (currentBlock.lines.length >= 60) {
            finalizeBlock(currentBlock);
            currentBlock = null;
          }
        } else {
          currentBlock = {
            startLine: i + 1,
            endLine: i + 1,
            kind: "section",
            name: "",
            lines: [line],
          };
        }
      }
      finalizeBlock(currentBlock);
      return chunks;
    }

    if (isCode) {
      // AST-guided syntactic block chunking
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Detect function, class, interface, type, struct, enum
        const fnMatch = line.match(/(?:(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)|(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>|def\s+([a-zA-Z0-9_]+)\s*\(|fn\s+([a-zA-Z0-9_]+)\s*\()/);
        const classMatch = line.match(/(?:export\s+)?(?:abstract\s+)?class\s+([a-zA-Z0-9_$]+)/);
        const typeMatch = line.match(/(?:export\s+)?(?:interface|type|struct|enum)\s+([a-zA-Z0-9_$]+)/);

        const isNewBoundary = fnMatch || classMatch || typeMatch;

        if (isNewBoundary) {
          finalizeBlock(currentBlock);
          const kind = classMatch ? "class" : typeMatch ? "type" : "function";
          const name = classMatch ? classMatch[1] : typeMatch ? typeMatch[1] : (fnMatch[1] || fnMatch[2] || fnMatch[3] || fnMatch[4] || "");
          currentBlock = {
            startLine: i + 1,
            endLine: i + 1,
            kind,
            name,
            lines: [line],
          };
        } else if (currentBlock) {
          currentBlock.lines.push(line);
          currentBlock.endLine = i + 1;
          // Sub-chunk if a single function is gigantic
          if (currentBlock.lines.length >= 80) {
            finalizeBlock(currentBlock);
            currentBlock = {
              startLine: Math.max(1, i - 5),
              endLine: i + 1,
              kind: currentBlock.kind,
              name: currentBlock.name,
              lines: lines.slice(Math.max(0, i - 5), i + 1),
            };
          }
        } else {
          // Top-level imports or prelude
          currentBlock = {
            startLine: i + 1,
            endLine: i + 1,
            kind: "prelude",
            name: "",
            lines: [line],
          };
        }
      }
      finalizeBlock(currentBlock);
      if (chunks.length > 0) return chunks;
    }

    // Default windowing for arbitrary files or where no functions were detected
    const chunkSize = 40;
    const overlap = 10;
    for (let i = 0; i < lines.length; i += (chunkSize - overlap)) {
      const chunkLines = lines.slice(i, i + chunkSize);
      if (!chunkLines.some((l) => l.trim().length > 0)) continue;
      const chunkText = chunkLines.join("\n");
      const tokens = this.tokenize(chunkText);
      if (!tokens.length) continue;

      chunks.push({
        id: `${relPath}:${i + 1}-${Math.min(i + chunkSize, lines.length)}`,
        path: relPath,
        startLine: i + 1,
        endLine: Math.min(i + chunkSize, lines.length),
        content: chunkText,
        kind: "block",
        name: "",
        tokens: new Set(tokens),
        termFreq: this.computeTermFrequency(tokens),
        docLength: tokens.length,
      });
    }

    return chunks;
  }

  async buildIndex() {
    this.status = "indexing";
    this.chunks = [];
    const filesToScan = [];

    const isExcludedDir = (name) => {
      return (
        SKIP_DIRS.has(name) ||
        EXTRA_SKIP_DIRS.has(name) ||
        (name.startsWith(".") && ![".github", ".claude", ".grok", ".agents", ".cursor", ".gemini"].includes(name))
      );
    };

    const walk = async (dir) => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const name = ent.name;
        if (isExcludedDir(name)) {
          continue;
        }
        const full = path.join(dir, name);
        if (ent.isDirectory()) {
          if (filesToScan.length < 2000) {
            await walk(full);
          }
        } else if (ent.isFile() && filesToScan.length < 2000) {
          const ext = (name.split(".").pop() || "").toLowerCase();
          if (!BINARY_EXTENSIONS.has(ext)) {
            try {
              const stat = await fs.stat(full);
              if (stat.size <= MAX_FILE_SIZE_BYTES) {
                filesToScan.push(full);
              }
            } catch {}
          }
        }
      }
    };

    await walk(this.workspaceRoot);
    this.totalFiles = filesToScan.length;
    this.indexedFiles = 0;

    for (const file of filesToScan) {
      try {
        const content = await fs.readFile(file, "utf8");
        const rel = toPosix(path.relative(this.workspaceRoot, file));
        const newChunks = this.chunkSyntactically(content, rel);
        this.chunks.push(...newChunks);
      } catch {
        // ignore read errors
      }
      this.indexedFiles++;
      this.progress = Math.round((this.indexedFiles / Math.max(1, this.totalFiles)) * 100);
    }

    this.recalculateStats();
    this.status = "ready";
  }

  async indexFile(filePath, providedContent) {
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(this.workspaceRoot, filePath);
    const relPath = toPosix(path.relative(this.workspaceRoot, absPath));

    // Remove existing chunks for this file
    this.removeFile(relPath, false);

    let content = providedContent;
    if (typeof content !== "string") {
      try {
        const stat = await fs.stat(absPath);
        if (stat.size > MAX_FILE_SIZE_BYTES) {
          this.recalculateStats();
          return;
        }
        content = await fs.readFile(absPath, "utf8");
      } catch {
        this.recalculateStats();
        return;
      }
    }

    const newChunks = this.chunkSyntactically(content, relPath);
    this.chunks.push(...newChunks);
    this.recalculateStats();
  }

  removeFile(filePath, doRecalculate = true) {
    const relPath = toPosix(path.isAbsolute(filePath) ? path.relative(this.workspaceRoot, filePath) : filePath);
    this.chunks = this.chunks.filter((c) => c.path !== relPath);
    if (doRecalculate) {
      this.recalculateStats();
    }
  }

  search(query, topK = 8) {
    const qTokens = this.tokenize(query);
    if (!qTokens.length || !this.chunks.length) return [];

    const N = this.chunks.length;
    const k1 = 1.2;
    const b = 0.75;
    const avgdl = this.avgDocLength || 1;

    // Calculate IDF for each query token
    const idfMap = new Map();
    for (const qt of qTokens) {
      const df = this.docFreq.get(qt) || 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      idfMap.set(qt, Math.max(0.1, idf));
    }

    const scored = [];
    for (const chunk of this.chunks) {
      let bm25Score = 0;
      let matchCount = 0;

      for (const qt of qTokens) {
        const tf = chunk.termFreq.get(qt) || 0;
        if (tf > 0) {
          matchCount++;
          const idf = idfMap.get(qt) || 0.1;
          const numerator = tf * (k1 + 1);
          const denominator = tf + k1 * (1 - b + b * (chunk.docLength / avgdl));
          bm25Score += idf * (numerator / denominator);
        }

        // Boost for filename and path matches
        const pathLower = chunk.path.toLowerCase();
        if (pathLower.includes(qt)) {
          bm25Score += 2.5;
        }
        const baseName = path.basename(chunk.path).toLowerCase();
        if (baseName.includes(qt)) {
          bm25Score += 3.5;
        }

        // Boost for syntactic symbol name match
        if (chunk.name && chunk.name.toLowerCase().includes(qt)) {
          bm25Score += 4.0;
        }
      }

      if (bm25Score > 0 && matchCount > 0) {
        scored.push({
          ...chunk,
          score: bm25Score,
        });
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
  MAX_FILE_SIZE_BYTES,
};
