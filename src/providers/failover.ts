import { isProviderId, PROVIDER_IDS, type ProviderAccount, type ProviderBundle, type ProviderId } from "./types";

export interface FailoverPolicy {
  enabled: boolean;
  order: ProviderId[];
  available?: ProviderId[];
}

export interface ProviderCallTarget {
  provider: ProviderId;
  account?: ProviderAccount;
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

/**
 * Builds the hierarchical failover chain of call targets:
 * For each provider (preferred first, then failover order, then remaining available),
 * it yields all enabled accounts of that provider.
 * If a provider has no explicit accounts, it yields a target using default settings.
 */
export function accountFailoverChain(
  preferred: ProviderId,
  bundle: ProviderBundle,
  order: ProviderId[],
  available: readonly ProviderId[] = PROVIDER_IDS,
): ProviderCallTarget[] {
  const providerOrder = failoverChain(preferred, order, available);
  const targets: ProviderCallTarget[] = [];

  for (const pid of providerOrder) {
    const provSettings = bundle[pid];
    // Gather accounts for this provider from either provider settings or bundle.accounts
    const allAccounts = [
      ...(provSettings?.accounts || []),
      ...((bundle.accounts || []).filter((a) => a.provider === pid)),
    ];
    // Deduplicate by ID
    const seen = new Set<string>();
    const enabledAccounts = allAccounts.filter((acc) => {
      if (acc.provider !== pid || acc.enabled === false || !acc.apiKey) return false;
      if (seen.has(acc.id)) return false;
      seen.add(acc.id);
      return true;
    });

    if (enabledAccounts.length > 0) {
      for (const acc of enabledAccounts) {
        targets.push({ provider: pid, account: acc });
      }
    } else {
      // Default single credential target
      targets.push({ provider: pid });
    }
  }

  return targets;
}
