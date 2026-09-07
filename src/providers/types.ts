export const PROVIDER_IDS = ["claude", "grok", "openai", "fcc"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

export type AuthKind = "apiKey" | "session";
export type AuthSource = "settings" | "env" | "terminal";
export type AccountAuthType = "apiKey" | "web";

export interface ProviderAccount {
  id: string;
  provider: ProviderId;
  name: string;
  apiKey: string;
  authType?: AccountAuthType;
  authKind?: AuthKind;
  baseUrl?: string;
  model?: string;
  enabled?: boolean;
}

export interface ProviderSettings {
  id: ProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  authKind?: AuthKind;
  authSource?: AuthSource;
  extraHeaders?: Record<string, string>;
  accounts?: ProviderAccount[];
  activeAccountId?: string;
}

export interface ProviderBundle {
  selected: ProviderId;
  claude: ProviderSettings;
  grok: ProviderSettings;
  openai: ProviderSettings;
  fcc: ProviderSettings;
  accounts?: ProviderAccount[];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "done"; text: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }; rateLimit?: { usedPercent?: number; remaining?: number; limit?: number; kind?: string } }
  | { type: "error"; error: string }
  | { type: "status"; text: string }
  | { type: "meta"; durationMs?: number; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }; rateLimit?: { usedPercent?: number; remaining?: number; limit?: number; kind?: string } };

export type StreamSink = (event: StreamEvent) => void;

export interface HttpTransport {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

export const defaultHttp: HttpTransport = {
  fetch: (input, init) => fetch(input, init),
};

export interface ChatCall {
  settings: ProviderSettings;
  messages: ChatMessage[];
  onEvent: StreamSink;
  http: HttpTransport;
  signal?: AbortSignal;
}
