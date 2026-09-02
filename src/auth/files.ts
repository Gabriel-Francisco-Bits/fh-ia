import { promises as fs } from "node:fs";

export interface TextFiles {
  read(absPath: string): Promise<string | undefined>;
  write(absPath: string, contents: string, mode?: number): Promise<void>;
}

export function nodeTextFiles(): TextFiles {
  return {
    async read(absPath) {
      try {
        return await fs.readFile(absPath, "utf8");
      } catch {
        return undefined;
      }
    },
    async write(absPath, contents, mode = 0o600) {
      await fs.writeFile(absPath, contents, { encoding: "utf8", mode });
    },
  };
}

export function memoryTextFiles(initial: Record<string, string> = {}): TextFiles & { store: Record<string, string> } {
  const store = { ...initial };
  return {
    store,
    async read(absPath) {
      return store[absPath];
    },
    async write(absPath, contents) {
      store[absPath] = contents;
    },
  };
}
