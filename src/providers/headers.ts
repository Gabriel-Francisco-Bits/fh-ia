import type { ProviderSettings } from "./types";

export function requestAuthHeaders(settings: ProviderSettings): Record<string, string> {
  const extra = settings.extraHeaders ?? {};
  if (settings.id === "fcc") {
    return {
      "anthropic-version": "2023-06-01",
      authorization: `Bearer ${settings.apiKey}`,
      ...extra,
    };
  }
  if (settings.id === "claude") {
    const headers: Record<string, string> = {
      "anthropic-version": "2023-06-01",
      ...extra,
    };
    if (settings.authKind === "session") {
      headers.authorization = `Bearer ${settings.apiKey}`;
      if (!headers["anthropic-beta"]) {
        headers["anthropic-beta"] = "oauth-2025-04-08";
      }
    } else {
      headers["x-api-key"] = settings.apiKey;
    }
    return headers;
  }
  return {
    authorization: `Bearer ${settings.apiKey}`,
    ...extra,
  };
}
