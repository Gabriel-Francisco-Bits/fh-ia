"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { SemanticIndex } = require("./semantic");

describe("SemanticIndex (Issue #17)", () => {
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
});
