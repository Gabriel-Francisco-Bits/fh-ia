import { randomUUID } from "node:crypto";
import type { AgentMode } from "./agent/modes";
import type { ChatMessage, ProviderId } from "./providers/types";

export interface ChatTranscriptItem {
  role: "user" | "assistant" | "system" | "error";
  text: string;
}

export interface ChatRecord {
  id: string;
  title: string;
  provider: ProviderId;
  model: string;
  mode: AgentMode;
  history: ChatMessage[];
  transcript: ChatTranscriptItem[];
  createdAt: number;
  updatedAt: number;
}

export function createChatRecord(input: {
  provider: ProviderId;
  mode: AgentMode;
  model: string;
  id?: string;
  title?: string;
  now?: number;
}): ChatRecord {
  const now = input.now ?? Date.now();
  return {
    id: input.id ?? randomUUID(),
    title: input.title ?? "Nuevo chat",
    provider: input.provider,
    model: input.model,
    mode: input.mode,
    history: [],
    transcript: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function titleFromFirstMessage(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) {
    return "Nuevo chat";
  }
  return t.length > 48 ? `${t.slice(0, 45)}…` : t;
}

export function capHistory(history: ChatMessage[], max = 40): ChatMessage[] {
  if (history.length <= max) {
    return history;
  }
  return history.slice(history.length - max);
}
