import { isProviderId, PROVIDER_IDS, type ProviderId } from "./types";

export interface FailoverPolicy {
  enabled: boolean;
  order: ProviderId[];
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
export function failoverChain(preferred: ProviderId, order: ProviderId[]): ProviderId[] {
  const chain: ProviderId[] = [];
  const push = (id: ProviderId) => {
    if (!chain.includes(id)) {
      chain.push(id);
    }
  };
  push(preferred);
  for (const id of order) {
    push(id);
  }
  for (const id of PROVIDER_IDS) {
    push(id);
  }
  return chain;
}
