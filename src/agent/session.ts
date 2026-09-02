import { ProviderDispatcher } from "../providers/dispatcher";
import type { ChatMessage, StreamSink } from "../providers/types";
import { extractProposedEdits, proposeEdit, type ProposedEdit } from "../workspace/edits";
import {
  buildOutboundMessages,
  DEFAULT_SYSTEM_PROMPT,
  gatherContext,
  type EditorPort,
} from "../workspace/context";
import type { FilePort } from "../workspace/files";
import { capHistory } from "../chats";
import { systemPromptForMode, type AgentMode } from "./modes";

export interface SessionResult {
  text: string;
  edits: ProposedEdit[];
  plannedEdits: ProposedEdit[];
  provider: string;
  history: ChatMessage[];
}

export class AgentSession {
  private history: ChatMessage[] = [];

  constructor(
    private readonly dispatcher: ProviderDispatcher,
    private readonly files: FilePort,
    private readonly editor: () => EditorPort,
  ) {}

  getHistory(): ChatMessage[] {
    return this.history;
  }

  setHistory(history: ChatMessage[]): void {
    this.history = capHistory(history);
  }

  clear(): void {
    this.history = [];
  }

  async send(
    userText: string,
    onEvent: StreamSink,
    mode: AgentMode = "ask",
  ): Promise<SessionResult> {
    const ctx = await gatherContext(userText, this.editor(), this.files);
    const outbound = buildOutboundMessages(
      userText,
      ctx,
      systemPromptForMode(mode, DEFAULT_SYSTEM_PROMPT),
    );
    const system = outbound[0];
    const user = outbound[1];
    const messages: ChatMessage[] = [system, ...this.history, user];
    const text = await this.dispatcher.chat(messages, onEvent);
    this.history = capHistory([...this.history, user, { role: "assistant", content: text }]);
    const originals: Record<string, string> = {};
    if (ctx.activeFile) {
      originals[ctx.activeFile.path] = ctx.activeFile.content;
    }
    for (const f of ctx.attachedFiles) {
      originals[f.path] = f.content;
    }
    const parsed = extractProposedEdits(text, originals);
    const resolved: ProposedEdit[] = [];
    for (const edit of parsed) {
      if (!originals[edit.path] && (await this.files.exists(edit.path))) {
        resolved.push(await proposeEdit(edit.path, edit.proposed, this.files));
      } else {
        resolved.push(edit);
      }
    }
    return {
      text,
      edits: mode === "plan" ? [] : resolved,
      plannedEdits: mode === "plan" ? resolved : [],
      provider: this.dispatcher.getLastUsed(),
      history: this.history,
    };
  }
}
