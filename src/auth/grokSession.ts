import path from "node:path";
import type { HttpTransport } from "../providers/types";
import type { TextFiles } from "./files";

export interface GrokSessionToken {
  token: string;
  refreshed: boolean;
}

interface GrokAuthEntry {
  key?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: string;
  oidc_issuer?: string;
  oidc_client_id?: string;
  auth_mode?: string;
  create_time?: string;
}

const EARLY_REFRESH_MS = 5 * 60 * 1000;

export function grokAuthPath(home: string): string {
  return path.join(home, ".grok", "auth.json");
}

export function parseGrokAuthFile(raw: string): { key: string; entry: GrokAuthEntry; map: Record<string, GrokAuthEntry> } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const map = parsed as Record<string, GrokAuthEntry>;
  const records = Object.entries(map).filter(([, v]) => v && typeof v === "object");
  if (records.length === 0) {
    return undefined;
  }
  records.sort((a, b) => entryTime(b[1]) - entryTime(a[1]));
  const [key, entry] = records[0];
  const token = entryToken(entry);
  if (!token) {
    return undefined;
  }
  return { key, entry, map };
}

export async function loadGrokSession(opts: {
  home: string;
  files: TextFiles;
  http: HttpTransport;
  now?: () => Date;
}): Promise<GrokSessionToken | undefined> {
  const filePath = grokAuthPath(opts.home);
  const raw = await opts.files.read(filePath);
  if (!raw) {
    return undefined;
  }
  const parsed = parseGrokAuthFile(raw);
  if (!parsed) {
    return undefined;
  }
  const now = opts.now?.() ?? new Date();
  const token = entryToken(parsed.entry);
  if (!token) {
    return undefined;
  }
  if (!needsRefresh(parsed.entry, now) || !parsed.entry.refresh_token) {
    return { token, refreshed: false };
  }
  try {
    const refreshed = await refreshGrokOidc(parsed.entry, opts.http);
    parsed.map[parsed.key] = { ...parsed.entry, ...refreshed };
    await opts.files.write(filePath, JSON.stringify(parsed.map, null, 2));
    return { token: refreshed.key || token, refreshed: true };
  } catch {
    if (isExpired(parsed.entry, now)) {
      return undefined;
    }
    return { token, refreshed: false };
  }
}

export async function refreshGrokOidc(
  entry: GrokAuthEntry,
  http: HttpTransport,
): Promise<{ key: string; refresh_token?: string; expires_at?: string }> {
  const issuer = (entry.oidc_issuer || "https://auth.x.ai").replace(/\/+$/, "");
  const clientId = entry.oidc_client_id;
  if (!entry.refresh_token || !clientId) {
    throw new Error("missing refresh_token or oidc_client_id");
  }
  const tokenUrl = await discoverTokenEndpoint(issuer, http);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: entry.refresh_token,
    client_id: clientId,
  });
  const res = await http.fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`OIDC refresh HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) {
    throw new Error("OIDC refresh missing access_token");
  }
  const expiresAt =
    typeof json.expires_in === "number"
      ? new Date(Date.now() + json.expires_in * 1000).toISOString()
      : entry.expires_at;
  return {
    key: json.access_token,
    refresh_token: json.refresh_token || entry.refresh_token,
    expires_at: expiresAt,
  };
}

async function discoverTokenEndpoint(issuer: string, http: HttpTransport): Promise<string> {
  try {
    const res = await http.fetch(`${issuer}/.well-known/openid-configuration`);
    if (res.ok) {
      const json = (await res.json()) as { token_endpoint?: string };
      if (json.token_endpoint) {
        return json.token_endpoint;
      }
    }
  } catch {
    // fall through to conventional path
  }
  return `${issuer}/oauth2/token`;
}

function entryToken(entry: GrokAuthEntry): string {
  return String(entry.access_token || entry.key || "").trim();
}

function entryTime(entry: GrokAuthEntry): number {
  const stamp = entry.expires_at || entry.create_time;
  const t = stamp ? Date.parse(stamp) : 0;
  return Number.isFinite(t) ? t : 0;
}

function needsRefresh(entry: GrokAuthEntry, now: Date): boolean {
  if (!entry.expires_at) {
    return false;
  }
  const exp = Date.parse(entry.expires_at);
  if (!Number.isFinite(exp)) {
    return false;
  }
  return exp - now.getTime() <= EARLY_REFRESH_MS;
}

function isExpired(entry: GrokAuthEntry, now: Date): boolean {
  if (!entry.expires_at) {
    return false;
  }
  const exp = Date.parse(entry.expires_at);
  return Number.isFinite(exp) && exp <= now.getTime();
}
