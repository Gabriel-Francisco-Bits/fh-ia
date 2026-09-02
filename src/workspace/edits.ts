import { randomUUID } from "node:crypto";
import type { FilePort } from "./files";

export interface DiffPayload {
  path: string;
  original: string;
  proposed: string;
  unified: string;
}

export interface ProposedEdit {
  id: string;
  path: string;
  original: string;
  proposed: string;
  diff: DiffPayload;
}

export function makeDiff(filePath: string, original: string, proposed: string): DiffPayload {
  return {
    path: filePath,
    original,
    proposed,
    unified: unifiedDiff(filePath, original, proposed),
  };
}

export function createProposedEdit(filePath: string, original: string, proposed: string): ProposedEdit {
  return {
    id: randomUUID(),
    path: filePath,
    original,
    proposed,
    diff: makeDiff(filePath, original, proposed),
  };
}

export async function proposeEdit(filePath: string, proposed: string, files: FilePort): Promise<ProposedEdit> {
  const original = (await files.exists(filePath)) ? await files.read(filePath) : "";
  return createProposedEdit(filePath, original, proposed);
}

/** Writes the proposed bytes to disk. */
export async function acceptEdit(edit: ProposedEdit, files: FilePort): Promise<void> {
  await files.write(edit.path, edit.proposed);
}

/** Leaves the original file unchanged (no disk write). */
export async function rejectEdit(_edit: ProposedEdit): Promise<void> {
  return;
}

export function unifiedDiff(filePath: string, original: string, proposed: string): string {
  const a = splitLines(original);
  const b = splitLines(proposed);
  const ops = diffLines(a, b);
  const hunks = [`--- a/${filePath}`, `+++ b/${filePath}`, `@@ -1,${a.length} +1,${b.length} @@`];
  for (const op of ops) {
    if (op.type === "equal") {
      hunks.push(` ${op.line}`);
    } else if (op.type === "del") {
      hunks.push(`-${op.line}`);
    } else {
      hunks.push(`+${op.line}`);
    }
  }
  return hunks.join("\n");
}

type DiffOp = { type: "equal" | "del" | "add"; line: string };

function splitLines(text: string): string[] {
  if (text === "") {
    return [];
  }
  return text.split("\n");
}

function diffLines(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "equal", line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "del", line: a[i] });
      i++;
    } else {
      ops.push({ type: "add", line: b[j] });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: "del", line: a[i++] });
  }
  while (j < m) {
    ops.push({ type: "add", line: b[j++] });
  }
  return ops;
}

const EDIT_TOOL_RE =
  /<tool\s+name=["']propose_edit["']\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/tool>/gi;
const FENCE_RE = /```(?:[\w.+-]+)?\s+([^\s\n]+)\n([\s\S]*?)```/g;

export function extractProposedEdits(
  assistantText: string,
  originals: Record<string, string> = {},
): ProposedEdit[] {
  const found: ProposedEdit[] = [];
  const seen = new Set<string>();

  const push = (filePath: string, body: string) => {
    const proposed = stripCdata(body).replace(/^\n/, "");
    if (seen.has(filePath)) {
      return;
    }
    seen.add(filePath);
    found.push(createProposedEdit(filePath, originals[filePath] ?? "", proposed));
  };

  for (const match of assistantText.matchAll(EDIT_TOOL_RE)) {
    push(match[1], match[2]);
  }
  for (const match of assistantText.matchAll(FENCE_RE)) {
    const p = match[1];
    if (p.includes("/") || /\.\w+$/.test(p)) {
      push(p, match[2]);
    }
  }
  return found;
}

function stripCdata(body: string): string {
  return body.replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "");
}
