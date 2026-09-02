import { promises as fs } from "node:fs";
import path from "node:path";

export interface FilePort {
  read(path: string): Promise<string>;
  write(path: string, contents: string): Promise<void>;
  exists(path: string): Promise<boolean>;
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
  };
}

export async function readWorkspaceFile(filePath: string, files: FilePort): Promise<string> {
  return files.read(filePath);
}
