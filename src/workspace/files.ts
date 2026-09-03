import { promises as fs } from "node:fs";
import path from "node:path";

export interface FilePort {
  read(path: string): Promise<string>;
  write(path: string, contents: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list?(max?: number): Promise<string[]>;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "out",
  "dist",
  "coverage",
  ".vscode-test",
  ".cache",
  "__pycache__",
]);

export async function listWorkspaceTree(root: string, max = 180): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    if (found.length >= max) {
      return;
    }
    let entries: Array<{ name: string; isDirectory(): boolean }> = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (found.length >= max) {
        return;
      }
      if (entry.name.startsWith(".") && entry.name !== ".github") {
        continue;
      }
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (entry.isDirectory()) {
        found.push(rel + "/");
        await walk(abs);
      } else {
        found.push(rel);
      }
    }
  };
  await walk(root);
  return found;
}

export function createNodeFilePort(root?: string): FilePort {
  const resolve = (p: string) => (path.isAbsolute(p) || !root ? p : path.join(root, p));
  return {
    async read(p) {
      return fs.readFile(resolve(p), "utf8");
    },
    async write(p, contents) {
      const abs = resolve(p);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, contents, "utf8");
    },
    async exists(p) {
      try {
        await fs.access(resolve(p));
        return true;
      } catch {
        return false;
      }
    },
    async list(max = 180) {
      if (!root) {
        return [];
      }
      return listWorkspaceTree(root, max);
    },
  };
}

export async function readWorkspaceFile(filePath: string, files: FilePort): Promise<string> {
  return files.read(filePath);
}
