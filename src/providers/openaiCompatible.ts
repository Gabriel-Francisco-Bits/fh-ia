import { requestAuthHeaders } from "./headers";
import { readSseFrames } from "./sse";
import type { ChatCall } from "./types";
import { chatCompletionsUrl } from "./urls";

/** Shared by Grok (xAI) and any OpenAI-compatible endpoint. */
export async function chatOpenAiCompatible(call: ChatCall): Promise<string> {
  const url = chatCompletionsUrl(call.settings.baseUrl);
  const res = await call.http.fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...requestAuthHeaders(call.settings),
    },
    body: JSON.stringify({
      model: call.settings.model,
      stream: true,
      messages: call.messages,
    }),
    signal: call.signal,
  });

  if (!res.ok) {
    const errText = await safeText(res);
    const label = call.settings.id === "grok" ? "Grok" : "OpenAI";
    const msg = `${label} HTTP ${res.status}: ${errText}`;
    call.onEvent({ type: "error", error: msg });
    throw new Error(msg);
  }

  // Extract rate limits from response headers if available
  let rateLimit: { usedPercent?: number; remaining?: number; limit?: number; kind?: string } | undefined;
  try {
    const tokLimit = res.headers.get("x-ratelimit-limit-tokens");
    const tokRem = res.headers.get("x-ratelimit-remaining-tokens");
    const reqLimit = res.headers.get("x-ratelimit-limit-requests");
    const reqRem = res.headers.get("x-ratelimit-remaining-requests");
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
    if (frame.data === "[DONE]") {
      continue;
    }
    try {
      if (frame.data) {
        const obj = JSON.parse(frame.data);
        if (obj.usage) {
          if (obj.usage.prompt_tokens) promptTokens = obj.usage.prompt_tokens;
          if (obj.usage.completion_tokens) completionTokens = obj.usage.completion_tokens;
        }
      }
    } catch {}

    const piece = extractOpenAiDelta(frame.data);
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

export function extractOpenAiDelta(data: string): string {
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
  const obj = parsed as {
    choices?: Array<{
      delta?: { content?: string | null };
      message?: { content?: string | null };
    }>;
  };
  const choice = obj.choices?.[0];
  return choice?.delta?.content || choice?.message?.content || "";
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}
