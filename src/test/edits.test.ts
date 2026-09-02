import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { acceptEdit, makeDiff, proposeEdit, rejectEdit } from "../workspace/edits";
import { createNodeFilePort, readWorkspaceFile } from "../workspace/files";

test("propose/accept writes new bytes; reject leaves original; diff includes both texts", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fh-ia-edits-"));
  const filePath = path.join(dir, "sample.ts");
  const original = "const n = 1;\n";
  const proposed = "const n = 2;\n";
  await writeFile(filePath, original, "utf8");
  const files = createNodeFilePort(dir);

  const fromDisk = await readWorkspaceFile(filePath, files);
  assert.equal(fromDisk, original);

  const edit = await proposeEdit(filePath, proposed, files);
  const diff = makeDiff(filePath, edit.original, edit.proposed);
  assert.equal(diff.original, original);
  assert.equal(diff.proposed, proposed);
  assert.match(diff.unified, /const n = 1/);
  assert.match(diff.unified, /const n = 2/);
  assert.equal(edit.diff.original, original);
  assert.equal(edit.diff.proposed, proposed);

  await rejectEdit(edit);
  assert.equal(await readFile(filePath, "utf8"), original, "reject must not write");

  await acceptEdit(edit, files);
  assert.equal(await readFile(filePath, "utf8"), proposed, "accept must write proposed bytes");
});
