import { missingMessage, passthroughCredentials, type CredentialResolver } from "../auth/resolve";
import { chatClaude } from "./claude";
import { chatOpenAiCompatible } from "./openaiCompatible";
import {
  defaultHttp,
  isProviderId,
  type ChatCall,
  type ChatMessage,
  type HttpTransport,
  type ProviderBundle,
  type ProviderId,
  type ProviderSettings,
  type StreamSink,
} from "./types";

export type ChatFn = (call: ChatCall) => Promise<string>;

const DEFAULT_CLIENTS: Record<ProviderId, ChatFn> = {
  claude: chatClaude,
  grok: chatOpenAiCompatible,
  openai: chatOpenAiCompatible,
};

export class ProviderDispatcher {
  private selected: ProviderId;
  private bundle: ProviderBundle;
  private readonly http: HttpTransport;
  private readonly clients: Record<ProviderId, ChatFn>;
  private readonly credentials: CredentialResolver;

  constructor(opts: {
    bundle: ProviderBundle;
    http?: HttpTransport;
    clients?: Partial<Record<ProviderId, ChatFn>>;
    credentials?: CredentialResolver;
  }) {
    this.bundle = opts.bundle;
    this.selected = opts.bundle.selected;
    this.http = opts.http ?? defaultHttp;
    this.clients = { ...DEFAULT_CLIENTS, ...opts.clients };
    this.credentials = opts.credentials ?? passthroughCredentials();
  }

  /** Switch IA without reloading the extension host. */
  setSelected(id: ProviderId): void {
    this.selected = id;
    this.bundle = { ...this.bundle, selected: id };
  }

  getSelected(): ProviderId {
    return this.selected;
  }

  updateBundle(bundle: ProviderBundle): void {
    this.bundle = bundle;
    this.selected = bundle.selected;
  }

  settingsFor(id: ProviderId = this.selected): ProviderSettings {
    return this.bundle[id];
  }

  async resolveActive(): Promise<ProviderSettings> {
    return this.credentials.resolve(this.selected, this.bundle[this.selected]);
  }

  async chat(messages: ChatMessage[], onEvent: StreamSink, signal?: AbortSignal): Promise<string> {
    const id = this.selected;
    let settings: ProviderSettings;
    try {
      settings = await this.credentials.resolve(id, this.bundle[id]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : missingMessage(id);
      onEvent({ type: "error", error: msg });
      throw new Error(msg);
    }
    if (!settings.apiKey) {
      const msg = missingMessage(id);
      onEvent({ type: "error", error: msg });
      throw new Error(msg);
    }
    const fn = this.clients[id];
    return fn({ settings, messages, onEvent, http: this.http, signal });
  }
}

export function selectProviderOrThrow(value: string): ProviderId {
  if (!isProviderId(value)) {
    throw new Error(`Unknown provider: ${value}`);
  }
  return value;
}
