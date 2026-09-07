import { isAgentMode, type AgentMode } from "./agent/modes";
import { isAuthMode, type AuthMode } from "./auth/resolve";
import { FCC_DEFAULT_BASE, FCC_DEFAULT_TOKEN } from "./providers/fcc";
import { parseFailoverOrder, type FailoverPolicy } from "./providers/failover";
import type { ProviderAccount, ProviderBundle, ProviderId, ProviderSettings } from "./providers/types";
import { isProviderId, PROVIDER_IDS } from "./providers/types";

export interface RawConfig {
  get<T>(key: string): T | undefined;
}

/** All fh-ia configuration keys. Passing `undefined` to VS Code restores the default. */
export const FHIA_CONFIG_KEYS = [
  "fhIa.authMode",
  "fhIa.provider",
  "fhIa.agentMode",
  "fhIa.failover.enabled",
  "fhIa.failover.order",
  "fhIa.accounts",
  "fhIa.disabledModels",
  "fhIa.disabledProviders",
  "fhIa.claude.enabled",
  "fhIa.claude.apiKey",
  "fhIa.claude.baseUrl",
  "fhIa.claude.model",
  "fhIa.grok.enabled",
  "fhIa.grok.apiKey",
  "fhIa.grok.baseUrl",
  "fhIa.grok.model",
  "fhIa.openai.enabled",
  "fhIa.openai.apiKey",
  "fhIa.openai.baseUrl",
  "fhIa.openai.model",
  "fhIa.fcc.enabled",
  "fhIa.fcc.apiKey",
  "fhIa.fcc.baseUrl",
  "fhIa.fcc.model",
  "fhIa.minimax.enabled",
  "fhIa.minimax.apiKey",
  "fhIa.minimax.baseUrl",
  "fhIa.minimax.model",
  "fhIa.minimax.cookie",
  "fhIa.ui.theme",
  "fhIa.ui.fontSize",
  "fhIa.ui.iconSize",
  "fhIa.ui.accent",
  "fhIa.ui.userBubble",
  "fhIa.ui.assistantBubble",
] as const;

export async function resetFhIaConfiguration(
  update: (key: string, value: undefined) => Promise<void>,
): Promise<void> {
  for (const key of FHIA_CONFIG_KEYS) {
    await update(key, undefined);
  }
}

export function resolveAuthMode(config: RawConfig): AuthMode {
  const raw = String(config.get("fhIa.authMode") ?? "auto");
  return isAuthMode(raw) ? raw : "auto";
}

export function resolveAgentMode(config: RawConfig): AgentMode {
  const raw = String(config.get("fhIa.agentMode") ?? "ask");
  return isAgentMode(raw) ? raw : "ask";
}

export type UiTheme = "auto" | "light" | "dark";

export interface UiSettings {
  theme: UiTheme;
  fontSize: number;
  iconSize: number;
  accent: string;
  userBubble: string;
  assistantBubble: string;
}

export function resolveUi(config: RawConfig): UiSettings {
  const themeRaw = String(config.get("fhIa.ui.theme") ?? "auto");
  const theme: UiTheme = themeRaw === "light" || themeRaw === "dark" ? themeRaw : "auto";
  const fontSize = Number(config.get("fhIa.ui.fontSize") ?? 16);
  const iconSize = Number(config.get("fhIa.ui.iconSize") ?? 18);
  return {
    theme,
    fontSize: Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 16,
    iconSize: Number.isFinite(iconSize) && iconSize > 0 ? iconSize : 18,
    accent: String(config.get("fhIa.ui.accent") ?? ""),
    userBubble: String(config.get("fhIa.ui.userBubble") ?? ""),
    assistantBubble: String(config.get("fhIa.ui.assistantBubble") ?? ""),
  };
}

export function resolveProviderEnabled(provider: ProviderId, config: RawConfig): boolean {
  const disabledList = config.get<string[]>("fhIa.disabledProviders");
  if (Array.isArray(disabledList) && disabledList.includes(provider)) {
    return false;
  }
  const perProviderKey = `fhIa.${provider}.enabled`;
  const perVal = config.get<boolean>(perProviderKey);
  if (perVal !== undefined && perVal !== null) {
    return Boolean(perVal);
  }
  return true;
}

export function resolveFccEnabled(config: RawConfig): boolean {
  return resolveProviderEnabled("fcc", config);
}

export function resolveAvailableProviders(config: RawConfig): ProviderId[] {
  const available = PROVIDER_IDS.filter((id) => resolveProviderEnabled(id, config));
  return available.length > 0 ? available : [...PROVIDER_IDS];
}

export function resolveFailover(config: RawConfig): FailoverPolicy {
  const enabled = config.get<boolean>("fhIa.failover.enabled");
  return {
    enabled: enabled !== false,
    order: parseFailoverOrder(config.get<string>("fhIa.failover.order")),
    available: resolveAvailableProviders(config),
  };
}

export function resolveProviderBundle(
  config: RawConfig,
  selectedOverride?: ProviderId,
): ProviderBundle {
  const rawSelected = selectedOverride ?? String(config.get("fhIa.provider") ?? "grok");
  const available = resolveAvailableProviders(config);
  let selected: ProviderId = isProviderId(rawSelected) ? rawSelected : "grok";
  if (!available.includes(selected)) {
    selected = available[0] || "grok";
  }
  const rawAccounts = config.get<unknown>("fhIa.accounts");
  let accounts: ProviderAccount[] = [];
  if (Array.isArray(rawAccounts)) {
    accounts = rawAccounts
      .filter(
        (a): a is ProviderAccount =>
          Boolean(a && typeof a === "object" && isProviderId((a as any).provider) && ((a as any).apiKey || (a as any).cookie)),
      )
      .map((a) => {
        const authType = (a as any).authType === "web" ? "web" : "apiKey";
        const authKind = authType === "web" || (a as any).authKind === "session" ? "session" : "apiKey";
        return {
          id: String(a.id || Math.random().toString(36).slice(2, 9)),
          provider: a.provider,
          name: String(a.name || a.provider),
          apiKey: String(a.apiKey || ""),
          cookie: a.cookie ? String(a.cookie) : undefined,
          authType,
          authKind,
          baseUrl: a.baseUrl ? String(a.baseUrl) : undefined,
          model: a.model ? String(a.model) : undefined,
          enabled: a.enabled !== false,
        };
      });
  }
  return {
    selected,
    accounts,
    claude: settings("claude", "https://api.anthropic.com", "claude-sonnet-4-20250514", config),
    grok: settings("grok", "https://api.x.ai", "grok-4", config),
    openai: settings("openai", "https://api.openai.com/v1", "gpt-4o", config),
    fcc: {
      ...settings("fcc", FCC_DEFAULT_BASE, "claude-sonnet-4-20250514", config),
      apiKey: String(config.get("fhIa.fcc.apiKey") || FCC_DEFAULT_TOKEN),
    },
    minimax: {
      ...settings("minimax", "https://api.minimaxi.chat/v1", "MiniMax-Text-01", config),
      cookie: config.get("fhIa.minimax.cookie") ? String(config.get("fhIa.minimax.cookie")) : undefined,
    },
  };
}

function settings(
  id: ProviderId,
  defaultBase: string,
  defaultModel: string,
  config: RawConfig,
): ProviderSettings {
  return {
    id,
    apiKey: String(config.get(`fhIa.${id}.apiKey`) || ""),
    baseUrl: String(config.get(`fhIa.${id}.baseUrl`) || defaultBase),
    model: String(config.get(`fhIa.${id}.model`) || defaultModel),
  };
}
