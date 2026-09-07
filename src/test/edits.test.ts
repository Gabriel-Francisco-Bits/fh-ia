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

test("extractProposedEdits ignores pseudo-tools and JSON actions, extracting only valid files", () => {
  const { extractProposedEdits } = require("../workspace/edits");

  // 1. Pseudo-tool call should be ignored
  const pseudoCall = `Voy a revisar el archivo.<tool name="propose_edit" path="read_issues">
{
  "action": "read_file",
  "file_path": "issues.md"
}
</tool>`;
  const edits1 = extractProposedEdits(pseudoCall);
  assert.equal(edits1.length, 0, "No debe crear edición para pseudo-acciones");

  // 2. Valid file path should be extracted
  const validCall = `Aquí está la solución:
<tool name="propose_edit" path="src/main.ts">
export const ready = true;
</tool>`;
  const edits2 = extractProposedEdits(validCall);
  assert.equal(edits2.length, 1);
  assert.equal(edits2[0].path, "src/main.ts");
  assert.match(edits2[0].proposed, /export const ready = true;/);
});
