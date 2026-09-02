export const PROVIDER_IDS = ["claude", "grok", "openai"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

export type AuthKind = "apiKey" | "session";
export type AuthSource = "settings" | "env" | "terminal";

export interface ProviderSettings {
  id: ProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  authKind?: AuthKind;
  authSource?: AuthSource;
  extraHeaders?: Record<string, string>;
}

export interface ProviderBundle {
  selected: ProviderId;
  claude: ProviderSettings;
  grok: ProviderSettings;
  openai: ProviderSettings;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "done"; text: string }
  | { type: "error"; error: string };

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
