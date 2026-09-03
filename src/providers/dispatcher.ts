import { missingMessage, passthroughCredentials, type CredentialResolver } from "../auth/resolve";
import { chatClaude } from "./claude";
import {
  DEFAULT_FAILOVER_ORDER,
  failoverChain,
  type FailoverPolicy,
} from "./failover";
import { chatOpenAiCompatible } from "./openaiCompatible";
import {
  defaultHttp,
  isProviderId,
  PROVIDER_IDS,
  type ChatCall,
  type ChatMessage,
  type HttpTransport,
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
};

export class ProviderDispatcher {
  private selected: ProviderId;
  private lastUsed: ProviderId;
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
    return this.credentials.resolve(this.selected, this.bundle[this.selected]);
  }

  async chat(messages: ChatMessage[], onEvent: StreamSink, signal?: AbortSignal): Promise<string> {
    const available = this.failover.available ?? PROVIDER_IDS;
    const chain = this.failover.enabled
      ? failoverChain(this.selected, this.failover.order, available)
      : [this.selected];
    const errors: string[] = [];

    for (let i = 0; i < chain.length; i++) {
      const id = chain[i];
      const buffered: StreamEvent[] = [];
      try {
        const settings = await this.credentials.resolve(id, this.bundle[id]);
        if (!settings.apiKey) {
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
        if (i > 0) {
          onEvent({
            type: "status",
            text: `Failover: ${chain[0]} falló → usando ${id}`,
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
        errors.push(`${id}: ${msg}`);
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
