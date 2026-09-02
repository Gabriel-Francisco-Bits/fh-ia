import path from "node:path";
import type { TextFiles } from "./files";

export function claudeCredentialsPath(home: string): string {
  return path.join(home, ".claude", ".credentials.json");
}

export async function loadClaudeSession(opts: {
  home: string;
  files: TextFiles;
  env?: NodeJS.ProcessEnv;
}): Promise<string | undefined> {
  const envToken = String(opts.env?.CLAUDE_CODE_OAUTH_TOKEN || opts.env?.ANTHROPIC_AUTH_TOKEN || "").trim();
  if (envToken) {
    return envToken;
  }
  const raw = await opts.files.read(claudeCredentialsPath(opts.home));
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as {
      claudeAiOauth?: { accessToken?: string; expiresAt?: number };
      accessToken?: string;
    };
    const token = String(parsed.claudeAiOauth?.accessToken || parsed.accessToken || "").trim();
    if (!token) {
      return undefined;
    }
    const exp = parsed.claudeAiOauth?.expiresAt;
    if (typeof exp === "number" && exp > 0 && exp < Date.now()) {
      return undefined;
    }
    return token;
  } catch {
    return undefined;
  }
}
