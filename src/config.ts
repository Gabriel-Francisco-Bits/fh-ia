import { isAgentMode, type AgentMode } from "./agent/modes";
import { isAuthMode, type AuthMode } from "./auth/resolve";
import { parseFailoverOrder, type FailoverPolicy } from "./providers/failover";
import type { ProviderBundle, ProviderId, ProviderSettings } from "./providers/types";
import { isProviderId } from "./providers/types";

export interface RawConfig {
  get<T>(key: string): T | undefined;
}

export function resolveAuthMode(config: RawConfig): AuthMode {
  const raw = String(config.get("fhIa.authMode") ?? "auto");
  return isAuthMode(raw) ? raw : "auto";
}

export function resolveAgentMode(config: RawConfig): AgentMode {
  const raw = String(config.get("fhIa.agentMode") ?? "ask");
  return isAgentMode(raw) ? raw : "ask";
}

export function resolveFailover(config: RawConfig): FailoverPolicy {
  const enabled = config.get<boolean>("fhIa.failover.enabled");
  return {
    enabled: enabled !== false,
    order: parseFailoverOrder(config.get<string>("fhIa.failover.order")),
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
