/** Join a provider base URL with the Anthropic Messages path. */
export function claudeMessagesUrl(baseUrl: string): string {
  const u = stripSlash(baseUrl);
  if (u.endsWith("/messages")) {
    return u;
  }
  if (u.endsWith("/v1")) {
    return `${u}/messages`;
  }
  return `${u}/v1/messages`;
}

/** Join a provider base URL with the OpenAI-compatible chat completions path. */
export function chatCompletionsUrl(baseUrl: string): string {
  const u = stripSlash(baseUrl);
  if (u.endsWith("/chat/completions")) {
    return u;
  }
  if (u.endsWith("/v1")) {
    return `${u}/chat/completions`;
  }
  return `${u}/v1/chat/completions`;
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
