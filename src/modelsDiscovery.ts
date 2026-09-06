import type { ProviderId } from "./providers/types";
import { MODEL_CATALOG, uniqueModels } from "./models";

export interface ProviderDiscoveryResult {
  ok: boolean;
  provider: ProviderId;
  models: string[];
  count: number;
  error?: string;
  source: "api" | "catalog";
}

export function sortOpenAiModels(models: string[]): string[] {
  const priorityPatterns = [
    /^gpt-4o/i,
    /^gpt-4\.5/i,
    /^gpt-4\.1/i,
    /^o3/i,
    /^o4/i,
    /^o1/i,
    /^gpt-4/i,
    /^chat/i,
    /^claude/i,
    /^deepseek/i,
    /^qwen/i,
    /^llama/i,
    /^mistral/i,
    /^gemini/i,
  ];

  const excluded = [
    /whisper/i,
    /embedding/i,
    /moderation/i,
    /tts/i,
    /dall-e/i,
    /audio/i,
    /realtime/i,
    /babbage/i,
    /davinci/i,
  ];

  const preferred: string[] = [];
  const other: string[] = [];
  const deprioritized: string[] = [];

  for (const m of models) {
    if (excluded.some((p) => p.test(m))) {
      deprioritized.push(m);
      continue;
    }
    const idx = priorityPatterns.findIndex((p) => p.test(m));
    if (idx !== -1) {
      preferred.push(m);
    } else {
      other.push(m);
    }
  }

  return [...preferred, ...other, ...deprioritized];
}

export async function fetchModelsForProvider(
  provider: ProviderId,
  settings: {
    apiKey?: string;
    baseUrl?: string;
    authKind?: "apiKey" | "session";
  },
  timeoutMs = 4500
): Promise<ProviderDiscoveryResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    if (provider === "claude") {
      const base = String(settings.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
      const headers: Record<string, string> = {
        accept: "application/json",
        "anthropic-version": "2023-06-01",
      };
      if (settings.apiKey) {
        if (settings.authKind === "session" || !settings.apiKey.startsWith("sk-ant-")) {
          headers["authorization"] = `Bearer ${settings.apiKey}`;
        } else {
          headers["x-api-key"] = settings.apiKey;
        }
      }

      if (!settings.apiKey) {
        return {
          ok: false,
          provider: "claude",
          models: [...MODEL_CATALOG.claude],
          count: MODEL_CATALOG.claude.length,
          error: "Sin clave de API configurada",
          source: "catalog",
        };
      }

      const res = await fetch(`${base}/v1/models`, {
        headers,
        signal: ctrl.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const body = (await res.json()) as { data?: Array<{ id?: string }> };
      const ids = (body.data || []).map((m) => m.id).filter((id): id is string => Boolean(id));
      const combined = uniqueModels([...ids, ...MODEL_CATALOG.claude]);

      return {
        ok: true,
        provider: "claude",
        models: combined,
        count: combined.length,
        source: "api",
      };
    }

    if (provider === "grok") {
      const base = String(settings.baseUrl || "https://api.x.ai/v1").replace(/\/+$/, "");
      const headers: Record<string, string> = {
        accept: "application/json",
      };
      if (settings.apiKey) {
        headers["authorization"] = `Bearer ${settings.apiKey}`;
      } else {
        return {
          ok: false,
          provider: "grok",
          models: [...MODEL_CATALOG.grok],
          count: MODEL_CATALOG.grok.length,
          error: "Sin clave de API configurada",
          source: "catalog",
        };
      }

      const res = await fetch(`${base}/models`, {
        headers,
        signal: ctrl.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const body = (await res.json()) as { data?: Array<{ id?: string }> };
      const ids = (body.data || []).map((m) => m.id).filter((id): id is string => Boolean(id));
      const combined = uniqueModels([...ids, ...MODEL_CATALOG.grok]);

      return {
        ok: true,
        provider: "grok",
        models: combined,
        count: combined.length,
        source: "api",
      };
    }

    if (provider === "openai") {
      const base = String(settings.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
      const headers: Record<string, string> = {
        accept: "application/json",
      };
      if (settings.apiKey) {
        headers["authorization"] = `Bearer ${settings.apiKey}`;
      } else {
        return {
          ok: false,
          provider: "openai",
          models: [...MODEL_CATALOG.openai],
          count: MODEL_CATALOG.openai.length,
          error: "Sin clave de API configurada",
          source: "catalog",
        };
      }

      const url = base.endsWith("/models") ? base : `${base}/models`;
      const res = await fetch(url, {
        headers,
        signal: ctrl.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const body = (await res.json()) as {
        data?: Array<{ id?: string }>;
        models?: Array<{ id?: string }>;
      };
      const rows = body.data || body.models || [];
      const ids = rows.map((m) => m.id).filter((id): id is string => Boolean(id));
      const sorted = sortOpenAiModels(ids);
      const combined = uniqueModels([...sorted, ...MODEL_CATALOG.openai]);

      return {
        ok: true,
        provider: "openai",
        models: combined,
        count: combined.length,
        source: "api",
      };
    }

    if (provider === "fcc") {
      const base = String(settings.baseUrl || "http://127.0.0.1:8082").replace(/\/+$/, "");
      const headers: Record<string, string> = {
        authorization: `Bearer ${settings.apiKey || "freecc"}`,
        accept: "application/json",
      };

      const res = await fetch(`${base}/v1/models`, {
        headers,
        signal: ctrl.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const body = (await res.json()) as {
        data?: Array<{ id?: string }>;
        models?: Array<{ id?: string }>;
      };
      const rows = body.data || body.models || [];
      const ids = rows.map((m) => m.id).filter((id): id is string => Boolean(id));
      const combined = uniqueModels([...ids, ...MODEL_CATALOG.fcc]);

      return {
        ok: true,
        provider: "fcc",
        models: combined,
        count: combined.length,
        source: "api",
      };
    }

    const genericCatalog: Record<string, string[]> = MODEL_CATALOG;
    const defaultCatalog = genericCatalog[provider as string] || [];
    return {
      ok: false,
      provider,
      models: [...defaultCatalog],
      count: defaultCatalog.length,
      error: `Proveedor desconocido: ${provider}`,
      source: "catalog",
    };
  } catch (err) {
    const defaultCatalog = MODEL_CATALOG[provider] || [];
    return {
      ok: false,
      provider,
      models: [...defaultCatalog],
      count: defaultCatalog.length,
      error: err instanceof Error ? err.message : String(err),
      source: "catalog",
    };
  } finally {
    clearTimeout(timer);
  }
}
