import type { ProviderId } from "./providers/types";

export const MODEL_CATALOG: Record<ProviderId, string[]> = {
  claude: [
    "claude-sonnet-4-20250514",
    "claude-opus-4-20250514",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
  ],
  grok: ["grok-4", "grok-3", "grok-3-mini", "grok-2-1212", "grok-2-vision-1212"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o3", "o4-mini", "o3-mini"],
  fcc: [
    "claude-sonnet-4-20250514",
    "claude-opus-4-20250514",
    "claude-3-5-haiku-20241022",
    "nvidia_nim/nvidia/nemotron-3-super-120b-a12b",
  ],
};

export function modelsFor(provider: ProviderId, current?: string): string[] {
  const list = [...MODEL_CATALOG[provider]];
  if (current && !list.includes(current)) {
    list.unshift(current);
  }
  return list;
}
