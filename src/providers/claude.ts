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

  let full = "";
  for await (const frame of readSseFrames(res)) {
    const piece = extractClaudeDelta(frame.data);
    if (piece) {
      full += piece;
      call.onEvent({ type: "text", text: piece });
    }
  }
  call.onEvent({ type: "done", text: full });
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
