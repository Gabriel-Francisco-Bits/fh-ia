import { defaultHttp, type HttpTransport } from "./types";

export const FCC_DEFAULT_BASE = "http://127.0.0.1:8082";
export const FCC_DEFAULT_TOKEN = "freecc";
export const FCC_PROJECT_URL = "https://github.com/Alishahryar1/free-claude-code";

export interface FccProbe {
  ok: boolean;
  models: string[];
  error?: string;
}

export async function probeFcc(opts: {
  baseUrl: string;
  apiKey: string;
  http?: HttpTransport;
  timeoutMs?: number;
}): Promise<FccProbe> {
  const base = String(opts.baseUrl || FCC_DEFAULT_BASE).replace(/\/+$/, "");
  const http = opts.http ?? defaultHttp;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 1500);
  const headers: Record<string, string> = {
    authorization: `Bearer ${opts.apiKey || FCC_DEFAULT_TOKEN}`,
    accept: "application/json",
  };
  try {
    const health = await http.fetch(`${base}/health`, { headers, signal: ctrl.signal });
    const models = await listFccModels(http, base, headers, ctrl.signal);
    return { ok: health.ok, models };
  } catch (err) {
    return {
      ok: false,
      models: [],
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function listFccModels(
  http: HttpTransport,
  base: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<string[]> {
  try {
    const res = await http.fetch(`${base}/v1/models`, { headers, signal });
    if (!res.ok) {
      return [];
    }
    const body = JSON.parse(await res.text()) as {
      data?: Array<{ id?: string }>;
      models?: Array<{ id?: string }>;
    };
    const rows = body.data ?? body.models ?? [];
    const ids: string[] = [];
    for (const row of rows) {
      if (row?.id && !ids.includes(row.id)) {
        ids.push(row.id);
      }
    }
    return ids;
  } catch {
    return [];
  }
}
