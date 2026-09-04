import { requestAuthHeaders } from "./headers";
import { readSseFrames } from "./sse";
import type { ChatCall } from "./types";
import { claudeMessagesUrl } from "./urls";

export async function chatClaude(call: ChatCall): Promise<string> {
  const url = claudeMessagesUrl(call.settings.baseUrl);
  const system = call.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const messages = call.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const res = await call.http.fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...requestAuthHeaders(call.settings),
    },
    body: JSON.stringify({
      model: call.settings.model,
      max_tokens: 4096,
      stream: true,
      system: system || undefined,
      messages,
    }),
    signal: call.signal,
  });

  if (!res.ok) {
    const errText = await safeText(res);
    const msg = `Claude HTTP ${res.status}: ${errText}`;
    call.onEvent({ type: "error", error: msg });
    throw new Error(msg);
  }

  // Extract rate limits from response headers if available
  let rateLimit: { usedPercent?: number; remaining?: number; limit?: number; kind?: string } | undefined;
  try {
    const tokLimit = res.headers.get("anthropic-ratelimit-tokens-limit");
    const tokRem = res.headers.get("anthropic-ratelimit-tokens-remaining");
    const reqLimit = res.headers.get("anthropic-ratelimit-requests-limit");
    const reqRem = res.headers.get("anthropic-ratelimit-requests-remaining");
    if (tokLimit && tokRem) {
      const limit = Number(tokLimit);
      const rem = Number(tokRem);
      if (limit > 0) {
        rateLimit = {
          limit,
          remaining: rem,
          usedPercent: Math.max(0, Math.min(100, Math.round(((limit - rem) / limit) * 100))),
          kind: "tokens",
        };
      }
    } else if (reqLimit && reqRem) {
      const limit = Number(reqLimit);
      const rem = Number(reqRem);
      if (limit > 0) {
        rateLimit = {
          limit,
          remaining: rem,
          usedPercent: Math.max(0, Math.min(100, Math.round(((limit - rem) / limit) * 100))),
          kind: "requests",
        };
      }
    }
  } catch {}

  let full = "";
  let promptTokens = 0;
  let completionTokens = 0;

  for await (const frame of readSseFrames(res)) {
    try {
      if (frame.data && frame.data !== "[DONE]") {
        const obj = JSON.parse(frame.data);
        if (obj.type === "message_start" && obj.message?.usage?.input_tokens) {
          promptTokens = obj.message.usage.input_tokens;
        }
        if (obj.type === "message_delta" && obj.usage?.output_tokens) {
          completionTokens = obj.usage.output_tokens;
        }
      }
    } catch {}

    const piece = extractClaudeDelta(frame.data);
    if (piece) {
      full += piece;
      call.onEvent({ type: "text", text: piece });
    }
  }

  const totalTokens = (promptTokens || completionTokens)
    ? promptTokens + completionTokens
    : Math.round(full.length / 4);

  const usage = {
    promptTokens: promptTokens || Math.round(call.messages.reduce((a, m) => a + m.content.length, 0) / 4),
    completionTokens: completionTokens || Math.round(full.length / 4),
    totalTokens,
  };

  call.onEvent({ type: "meta", usage, rateLimit });
  call.onEvent({ type: "done", text: full, usage, rateLimit });
  return full;
}

export function extractClaudeDelta(data: string): string {
  if (!data || data === "[DONE]") {
    return "";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return "";
  }
  if (!parsed || typeof parsed !== "object") {
    return "";
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.type === "content_block_delta") {
    const delta = obj.delta as { type?: string; text?: string } | undefined;
    return delta?.text ?? "";
  }
  if (Array.isArray(obj.content)) {
    return obj.content
      .map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text ?? "") : ""))
      .join("");
  }
  return "";
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}
