export interface SseFrame {
  event?: string;
  data: string;
}

/**
 * Incrementally parse an HTTP response as Server-Sent Events.
 * Also accepts a one-shot JSON body (non-stream) as a single synthetic frame.
 */
export async function* readSseFrames(res: Response): AsyncGenerator<SseFrame> {
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  if (!res.body) {
    const text = await res.text();
    if (text) {
      yield { data: text };
    }
    return;
  }

  if (ctype.includes("application/json") && !ctype.includes("text/event-stream")) {
    const text = await res.text();
    if (text) {
      yield { data: text };
    }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buf += decoder.decode();
      break;
    }
    buf += decoder.decode(value, { stream: true });
    const blocks = buf.split("\n\n");
    buf = blocks.pop() ?? "";
    for (const block of blocks) {
      const frame = parseSseBlock(block);
      if (frame) {
        yield frame;
      }
    }
  }
  if (buf.trim()) {
    const frame = parseSseBlock(buf);
    if (frame) {
      yield frame;
    }
  }
}

export function parseSseBlock(block: string): SseFrame | undefined {
  const lines = block.replace(/\r/g, "").split("\n");
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) {
    return undefined;
  }
  return { event, data: dataLines.join("\n") };
}
