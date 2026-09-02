import path from "node:path";
import type { TextFiles } from "./files";

export function openaiAuthPath(home: string): string {
  return path.join(home, ".codex", "auth.json");
}

export async function loadOpenAiSession(opts: {
  home: string;
  files: TextFiles;
}): Promise<{ token: string; kind: "apiKey" | "session" } | undefined> {
  const raw = await opts.files.read(openaiAuthPath(opts.home));
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as {
      OPENAI_API_KEY?: string | null;
      tokens?: { access_token?: string };
    };
    const apiKey = String(parsed.OPENAI_API_KEY || "").trim();
    if (apiKey) {
      return { token: apiKey, kind: "apiKey" };
    }
    const access = String(parsed.tokens?.access_token || "").trim();
    if (access) {
      return { token: access, kind: "session" };
    }
    return undefined;
  } catch {
    return undefined;
  }
}
