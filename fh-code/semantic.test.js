"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { SemanticIndex } = require("./semantic");

describe("SemanticIndex (Issue #17 & Issue #24)", () => {
  it("indexes repository files into chunks and finds relevant semantic hits", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "fh-semantic-test-"));
    try {
      await fs.writeFile(
        path.join(tmp, "auth.ts"),
        "export function loginWithJwt(token: string) { return verifyToken(token); }\n"
      );
      await fs.writeFile(
        path.join(tmp, "database.ts"),
        "export function connectPostgres(uri: string) { return pg.createPool(uri); }\n"
      );

      const indexer = new SemanticIndex(tmp);
      await indexer.buildIndex();

      const status = indexer.getStatus();
      assert.equal(status.status, "ready");
      assert.equal(status.files, 2);
      assert.ok(status.chunks >= 2);

      const hits = indexer.search("login jwt token");
      assert.ok(hits.length > 0);
      assert.equal(hits[0].path, "auth.ts");
      assert.ok(hits[0].content.includes("loginWithJwt"));

      const dbHits = indexer.search("database postgres pool");
      assert.ok(dbHits.length > 0);
      assert.equal(dbHits[0].path, "database.ts");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("performs AST/syntactic chunking by functions, classes, and types (Issue #24)", () => {
    const indexer = new SemanticIndex("/fake");
    const code = `
import { something } from "./dep";

export class AuthService {
  private secret = "xyz";
  constructor() {}
}

export function validateSession(token: string) {
  return token.length > 10;
}

export interface UserProfile {
  id: string;
  name: string;
}
`;
    const chunks = indexer.chunkSyntactically(code, "services/auth.ts");
    assert.ok(chunks.length >= 3);
    const classChunk = chunks.find((c) => c.kind === "class" && c.name === "AuthService");
    assert.ok(classChunk, "Should extract class chunk");
    assert.equal(classChunk.path, "services/auth.ts");

    const fnChunk = chunks.find((c) => c.kind === "function" && c.name === "validateSession");
    assert.ok(fnChunk, "Should extract function chunk");

    const typeChunk = chunks.find((c) => c.kind === "type" && c.name === "UserProfile");
    assert.ok(typeChunk, "Should extract type/interface chunk");
  });

  it("skips files larger than 256KB and excludes heavy artifact directories (Issue #24)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "fh-semantic-heavy-"));
    try {
      // Create regular file
      await fs.writeFile(path.join(tmp, "normal.ts"), "export function normal() {}\n");

      // Create heavy file (>256KB)
      const bigContent = "a".repeat(300 * 1024);
      await fs.writeFile(path.join(tmp, "large-bundle.js"), bigContent);

      // Create ignored directories (.dart_tool, build, target, node_modules)
      await fs.mkdir(path.join(tmp, ".dart_tool"), { recursive: true });
      await fs.writeFile(path.join(tmp, ".dart_tool", "package_config.json"), '{"config":1}');

      await fs.mkdir(path.join(tmp, "build"), { recursive: true });
      await fs.writeFile(path.join(tmp, "build", "output.js"), 'console.log("build");');

      await fs.mkdir(path.join(tmp, "target"), { recursive: true });
      await fs.writeFile(path.join(tmp, "target", "binary.rs"), 'fn main() {}');

      const indexer = new SemanticIndex(tmp);
      await indexer.buildIndex();

      const status = indexer.getStatus();
      assert.equal(status.files, 1); // Only normal.ts should be indexed!
      assert.ok(indexer.chunks.every((c) => c.path === "normal.ts"));
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("supports incremental file indexing and removal (Issue #24)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "fh-semantic-incr-"));
    try {
      await fs.writeFile(path.join(tmp, "fileA.ts"), "export function alpha() { return 1; }\n");
      const indexer = new SemanticIndex(tmp);
      await indexer.buildIndex();
      assert.equal(indexer.chunks.length, 1);

      // Incremental addition
      await fs.writeFile(path.join(tmp, "fileB.ts"), "export function beta() { return 2; }\n");
      await indexer.indexFile(path.join(tmp, "fileB.ts"));
      assert.equal(indexer.chunks.length, 2);

      const hitB = indexer.search("beta");
      assert.ok(hitB.length > 0);
      assert.equal(hitB[0].path, "fileB.ts");

      // Incremental removal
      indexer.removeFile("fileA.ts");
      assert.equal(indexer.chunks.length, 1);
      assert.equal(indexer.chunks[0].path, "fileB.ts");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
