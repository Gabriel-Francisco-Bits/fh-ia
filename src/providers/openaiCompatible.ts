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

  let full = "";
  for await (const frame of readSseFrames(res)) {
    if (frame.data === "[DONE]") {
      continue;
    }
    const piece = extractOpenAiDelta(frame.data);
    if (piece) {
      full += piece;
      call.onEvent({ type: "text", text: piece });
    }
  }
  call.onEvent({ type: "done", text: full });
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
