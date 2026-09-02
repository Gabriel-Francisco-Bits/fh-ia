import http from "node:http";
import type { AddressInfo } from "node:net";

export interface CapturedRequest {
  method: string;
  url: string;
  path: string;
  host: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface FakeServer {
  url: string;
  port: number;
  host: string;
  requests: CapturedRequest[];
  close(): Promise<void>;
}

export function startSseServer(opts: {
  pathSuffix: string;
  reply: string;
  kind: "claude" | "openai";
}): Promise<FakeServer> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const host = String(req.headers.host || "");
      const url = req.url || "/";
      requests.push({
        method: req.method || "",
        url,
        path: url.split("?")[0],
        host,
        headers: req.headers,
        body,
      });
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "close",
      });
      if (opts.kind === "claude") {
        res.write("event: content_block_delta\n");
        res.write(
          `data: ${JSON.stringify({
            type: "content_block_delta",
            delta: { type: "text_delta", text: opts.reply },
          })}\n\n`,
        );
        res.write("event: message_stop\n");
        res.write(`data: ${JSON.stringify({ type: "message_stop" })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: opts.reply } }] })}\n\n`);
        res.write("data: [DONE]\n\n");
      }
      res.end();
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        port: addr.port,
        host: `127.0.0.1:${addr.port}`,
        requests,
        close: () =>
          new Promise((resClose, rej) => {
            server.close((err) => (err ? rej(err) : resClose()));
          }),
      });
    });
    server.on("error", reject);
  });
}

export function startFailingServer(opts: { status: number; body?: string }): Promise<FakeServer> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const host = String(req.headers.host || "");
      const url = req.url || "/";
      requests.push({
        method: req.method || "",
        url,
        path: url.split("?")[0],
        host,
        headers: req.headers,
        body,
      });
      res.writeHead(opts.status, { "content-type": "application/json" });
      res.end(opts.body ?? JSON.stringify({ error: "unavailable" }));
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        port: addr.port,
        host: `127.0.0.1:${addr.port}`,
        requests,
        close: () =>
          new Promise((resClose, rej) => {
            server.close((err) => (err ? rej(err) : resClose()));
          }),
      });
    });
    server.on("error", reject);
  });
}
