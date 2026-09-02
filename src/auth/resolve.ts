import os from "node:os";
import { defaultHttp, type HttpTransport, type ProviderId, type ProviderSettings } from "../providers/types";
import { loadClaudeSession } from "./claudeSession";
import { memoryTextFiles, nodeTextFiles, type TextFiles } from "./files";
import { loadGrokSession } from "./grokSession";
import { loadOpenAiSession } from "./openaiSession";

export type AuthMode = "auto" | "apiKey" | "terminal";
export type AuthKind = "apiKey" | "session";
export type AuthSource = "settings" | "env" | "terminal";

export interface ResolvedCredential extends ProviderSettings {
  authKind: AuthKind;
  authSource: AuthSource;
}

export interface CredentialResolver {
  resolve(id: ProviderId, settings: ProviderSettings): Promise<ResolvedCredential>;
}

export const ENV_KEYS: Record<ProviderId, string> = {
  claude: "ANTHROPIC_API_KEY",
  grok: "XAI_API_KEY",
  openai: "OPENAI_API_KEY",
};

export const LOGIN_HINT: Record<ProviderId, string> = {
  claude: "Run `claude` in a terminal and log in, or set fhIa.claude.apiKey / ANTHROPIC_API_KEY.",
  grok: "Run `grok login` in a terminal, or set fhIa.grok.apiKey / XAI_API_KEY.",
  openai: "Log in with Codex (`codex`) or set fhIa.openai.apiKey / OPENAI_API_KEY.",
};

export function isAuthMode(value: string): value is AuthMode {
  return value === "auto" || value === "apiKey" || value === "terminal";
}

export function passthroughCredentials(): CredentialResolver {
  return {
    async resolve(_id, settings) {
      if (!settings.apiKey) {
        throw new Error(missingMessage(settings.id));
      }
      return {
        ...settings,
        authKind: settings.authKind ?? "apiKey",
        authSource: settings.authSource ?? "settings",
      };
    },
  };
}

export function createTerminalCredentialResolver(opts: {
  home?: string;
  env?: NodeJS.ProcessEnv;
  files?: TextFiles;
  http?: HttpTransport;
  authMode?: AuthMode | (() => AuthMode);
  now?: () => Date;
}): CredentialResolver {
  const home = opts.home ?? os.homedir();
  const env = opts.env ?? process.env;
  const files = opts.files ?? nodeTextFiles();
  const http = opts.http ?? defaultHttp;
  const authModeOf = (): AuthMode =>
    typeof opts.authMode === "function" ? opts.authMode() : (opts.authMode ?? "auto");

  return {
    async resolve(id, settings) {
      const authMode = authModeOf();
      const settingKey = settings.apiKey.trim();
      if (authMode !== "terminal" && settingKey) {
        return tagged(settings, settingKey, "apiKey", "settings");
      }
      if (authMode !== "apiKey") {
        const session = await loadTerminalSession(id, { home, files, http, env, now: opts.now });
        if (session) {
          return tagged(settings, session.token, session.kind, "terminal", session.extraHeaders);
        }
      }
      if (authMode !== "terminal") {
        const envKey = String(env[ENV_KEYS[id]] || "").trim();
        if (envKey) {
          return tagged(settings, envKey, "apiKey", "env");
        }
      }
      throw new Error(missingMessage(id));
    },
  };
}

async function loadTerminalSession(
  id: ProviderId,
  ctx: { home: string; files: TextFiles; http: HttpTransport; env: NodeJS.ProcessEnv; now?: () => Date },
): Promise<{ token: string; kind: AuthKind; extraHeaders?: Record<string, string> } | undefined> {
  if (id === "grok") {
    const grok = await loadGrokSession(ctx);
    if (grok?.token) {
      return { token: grok.token, kind: "session" };
    }
    return undefined;
  }
  if (id === "claude") {
    const token = await loadClaudeSession(ctx);
    if (token) {
      return {
        token,
        kind: "session",
        extraHeaders: { "anthropic-beta": "oauth-2025-04-08" },
      };
    }
    return undefined;
  }
  const openai = await loadOpenAiSession(ctx);
  if (openai) {
    return { token: openai.token, kind: openai.kind };
  }
  return undefined;
}

function tagged(
  settings: ProviderSettings,
  token: string,
  kind: AuthKind,
  source: AuthSource,
  extraHeaders?: Record<string, string>,
): ResolvedCredential {
  return {
    ...settings,
    apiKey: token,
    authKind: kind,
    authSource: source,
    extraHeaders: { ...settings.extraHeaders, ...extraHeaders },
  };
}

export function missingMessage(id: ProviderId): string {
  return `No credential for ${id}. ${LOGIN_HINT[id]}`;
}

export { memoryTextFiles, nodeTextFiles };
