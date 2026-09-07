import { missingMessage, passthroughCredentials, type CredentialResolver } from "../auth/resolve";
import { chatClaude } from "./claude";
import {
  accountFailoverChain,
  DEFAULT_FAILOVER_ORDER,
  type FailoverPolicy,
  type ProviderCallTarget,
} from "./failover";
import { chatOpenAiCompatible } from "./openaiCompatible";
import {
  defaultHttp,
  isProviderId,
  PROVIDER_IDS,
  type ChatCall,
  type ChatMessage,
  type HttpTransport,
  type ProviderAccount,
  type ProviderBundle,
  type ProviderId,
  type ProviderSettings,
  type StreamEvent,
  type StreamSink,
} from "./types";

export type ChatFn = (call: ChatCall) => Promise<string>;

const DEFAULT_CLIENTS: Record<ProviderId, ChatFn> = {
  claude: chatClaude,
  grok: chatOpenAiCompatible,
  openai: chatOpenAiCompatible,
  fcc: chatClaude,
  minimax: chatOpenAiCompatible,
};

function formatTarget(target: ProviderCallTarget): string {
  if (target.account?.name) {
    return `${target.provider} [${target.account.name}]`;
  }
  return target.provider;
}

export class ProviderDispatcher {
  private selected: ProviderId;
  private lastUsed: ProviderId;
  private lastUsedAccount?: ProviderAccount;
  private bundle: ProviderBundle;
  private failover: FailoverPolicy;
  private readonly http: HttpTransport;
  private readonly clients: Record<ProviderId, ChatFn>;
  private readonly credentials: CredentialResolver;

  constructor(opts: {
    bundle: ProviderBundle;
    http?: HttpTransport;
    clients?: Partial<Record<ProviderId, ChatFn>>;
    credentials?: CredentialResolver;
    failover?: FailoverPolicy;
  }) {
    this.bundle = opts.bundle;
    this.selected = opts.bundle.selected;
    this.lastUsed = opts.bundle.selected;
    this.http = opts.http ?? defaultHttp;
    this.clients = { ...DEFAULT_CLIENTS, ...opts.clients };
    this.credentials = opts.credentials ?? passthroughCredentials();
    this.failover = opts.failover ?? { enabled: true, order: [...DEFAULT_FAILOVER_ORDER] };
  }

  /** Switch IA without reloading the extension host. */
  setSelected(id: ProviderId): void {
    this.selected = id;
    this.bundle = { ...this.bundle, selected: id };
  }

  getSelected(): ProviderId {
    return this.selected;
  }

  getLastUsed(): ProviderId {
    return this.lastUsed;
  }

  getLastUsedAccount(): ProviderAccount | undefined {
    return this.lastUsedAccount;
  }

  updateBundle(bundle: ProviderBundle): void {
    this.bundle = bundle;
    this.selected = bundle.selected;
  }

  updateFailover(policy: FailoverPolicy): void {
    this.failover = policy;
  }

  settingsFor(id: ProviderId = this.selected): ProviderSettings {
    return this.bundle[id];
  }

  async resolveActive(): Promise<ProviderSettings> {
    const accounts = [
      ...(this.bundle[this.selected]?.accounts || []),
      ...((this.bundle.accounts || []).filter((a) => a.provider === this.selected)),
    ];
    const activeAcc = accounts.find((a) => a.enabled !== false && (a.apiKey || a.cookie));
    const raw = activeAcc
      ? {
          ...this.bundle[this.selected],
          apiKey: activeAcc.apiKey,
          cookie: activeAcc.cookie || this.bundle[this.selected].cookie,
          baseUrl: activeAcc.baseUrl || this.bundle[this.selected].baseUrl,
          model: activeAcc.model || this.bundle[this.selected].model,
        }
      : this.bundle[this.selected];
    return this.credentials.resolve(this.selected, raw);
  }

  async chat(messages: ChatMessage[], onEvent: StreamSink, signal?: AbortSignal): Promise<string> {
    const available = this.failover.available ?? PROVIDER_IDS;
    const chain: ProviderCallTarget[] = this.failover.enabled
      ? accountFailoverChain(this.selected, this.bundle, this.failover.order, available)
      : accountFailoverChain(this.selected, this.bundle, [], [this.selected]);
    const errors: string[] = [];

    for (let i = 0; i < chain.length; i++) {
      const target = chain[i];
      const id = target.provider;
      const buffered: StreamEvent[] = [];
      try {
        const rawSettings: ProviderSettings = target.account
          ? {
              ...this.bundle[id],
              apiKey: target.account.apiKey,
              cookie: target.account.cookie || this.bundle[id].cookie,
              baseUrl: target.account.baseUrl || this.bundle[id].baseUrl,
              model: target.account.model || this.bundle[id].model,
              authKind:
                target.account.authType === "web" || target.account.authKind === "session"
                  ? "session"
                  : (target.account.authKind || "apiKey"),
            }
          : this.bundle[id];
        const settings = await this.credentials.resolve(id, rawSettings);

        if (!settings.apiKey && !settings.cookie) {
          throw new Error(missingMessage(id));
        }
        const fn = this.clients[id];
        const text = await fn({
          settings,
          messages,
          onEvent: (event) => {
            buffered.push(event);
          },
          http: this.http,
          signal,
        });
        this.lastUsed = id;
        this.lastUsedAccount = target.account;
        if (i > 0) {
          const prev = formatTarget(chain[i - 1]);
          const current = formatTarget(target);
          onEvent({
            type: "status",
            text: `Failover: ${prev} falló → usando ${current}`,
          });
        }
        for (const event of buffered) {
          if (event.type !== "error") {
            onEvent(event);
          }
        }
        return text;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const label = formatTarget(target);
        errors.push(`${label}: ${msg}`);
        if (!this.failover.enabled) {
          onEvent({ type: "error", error: msg });
          throw new Error(msg);
        }
      }
    }

    const combined = errors.join(" | ") || missingMessage(this.selected);
    onEvent({ type: "error", error: combined });
    throw new Error(combined);
  }
}

export function selectProviderOrThrow(value: string): ProviderId {
  if (!isProviderId(value)) {
    throw new Error(`Unknown provider: ${value}`);
  }
  return value;
}
