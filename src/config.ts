import { isAgentMode, type AgentMode } from "./agent/modes";
import { isAuthMode, type AuthMode } from "./auth/resolve";
import { FCC_DEFAULT_BASE, FCC_DEFAULT_TOKEN } from "./providers/fcc";
import { parseFailoverOrder, type FailoverPolicy } from "./providers/failover";
import type { ProviderBundle, ProviderId, ProviderSettings } from "./providers/types";
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
  "fhIa.claude.apiKey",
  "fhIa.claude.baseUrl",
  "fhIa.claude.model",
  "fhIa.grok.apiKey",
  "fhIa.grok.baseUrl",
  "fhIa.grok.model",
  "fhIa.openai.apiKey",
  "fhIa.openai.baseUrl",
  "fhIa.openai.model",
  "fhIa.fcc.enabled",
  "fhIa.fcc.apiKey",
  "fhIa.fcc.baseUrl",
  "fhIa.fcc.model",
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

export function resolveFccEnabled(config: RawConfig): boolean {
  return config.get<boolean>("fhIa.fcc.enabled") !== false;
}

export function resolveAvailableProviders(config: RawConfig): ProviderId[] {
  return PROVIDER_IDS.filter((id) => (id === "fcc" ? resolveFccEnabled(config) : true));
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
  const selected: ProviderId = isProviderId(rawSelected) ? rawSelected : "grok";
  return {
    selected,
    claude: settings("claude", "https://api.anthropic.com", "claude-sonnet-4-20250514", config),
    grok: settings("grok", "https://api.x.ai", "grok-4", config),
    openai: settings("openai", "https://api.openai.com/v1", "gpt-4o", config),
    fcc: {
      ...settings("fcc", FCC_DEFAULT_BASE, "claude-sonnet-4-20250514", config),
      apiKey: String(config.get("fhIa.fcc.apiKey") || FCC_DEFAULT_TOKEN),
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
