import { isProviderId, PROVIDER_IDS, type ProviderId } from "./types";

export interface FailoverPolicy {
  enabled: boolean;
  order: ProviderId[];
  available?: ProviderId[];
}

export const DEFAULT_FAILOVER_ORDER: ProviderId[] = ["grok", "claude", "openai"];

export function parseFailoverOrder(raw: string | undefined): ProviderId[] {
  const parsed = String(raw ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(isProviderId);
  return parsed.length > 0 ? parsed : [...DEFAULT_FAILOVER_ORDER];
}

/** Preferred provider first, then configured order, then any remaining IAs. */
export function failoverChain(
  preferred: ProviderId,
  order: ProviderId[],
  available: readonly ProviderId[] = PROVIDER_IDS,
): ProviderId[] {
  const chain: ProviderId[] = [];
  const push = (id: ProviderId) => {
    if (!chain.includes(id) && (available.includes(id) || id === preferred)) {
      chain.push(id);
    }
  };
  push(preferred);
  for (const id of order) {
    push(id);
  }
  for (const id of available) {
    push(id);
  }
  return chain;
}
