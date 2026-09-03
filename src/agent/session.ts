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
import { discoverSkills, renderSkillsForPrompt } from "../workspace/skills";
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
    private readonly home?: string,
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
    const editor = this.editor();
    const ctx = await gatherContext(userText, editor, this.files);
    let system = systemPromptForMode(mode, DEFAULT_SYSTEM_PROMPT);
    try {
      const bundle = await discoverSkills({ workspaceRoot: editor.workspaceRoot, home: this.home });
      const skillBlock = renderSkillsForPrompt(bundle, userText);
      if (skillBlock) {
        system = `${system}\n\n${skillBlock}`;
      }
    } catch {
      // skills are optional; never fail a turn because a skill file is unreadable
    }
    const outbound = buildOutboundMessages(userText, ctx, system);
    const systemMsg = outbound[0];
    const user = outbound[1];
    const messages: ChatMessage[] = [systemMsg, ...this.history, user];
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
