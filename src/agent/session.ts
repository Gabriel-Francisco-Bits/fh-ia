import { ProviderDispatcher } from "../providers/dispatcher";
import type { ChatMessage, StreamSink } from "../providers/types";
import { extractProposedEdits, proposeEdit, type ProposedEdit } from "../workspace/edits";
import { buildOutboundMessages, gatherContext, type EditorPort } from "../workspace/context";
import type { FilePort } from "../workspace/files";

export interface SessionResult {
  text: string;
  edits: ProposedEdit[];
  provider: string;
}

export class AgentSession {
  constructor(
    private readonly dispatcher: ProviderDispatcher,
    private readonly files: FilePort,
    private readonly editor: () => EditorPort,
  ) {}

  async send(userText: string, onEvent: StreamSink): Promise<SessionResult> {
    const ctx = await gatherContext(userText, this.editor(), this.files);
    const messages: ChatMessage[] = buildOutboundMessages(userText, ctx);
    const text = await this.dispatcher.chat(messages, onEvent);
    const originals: Record<string, string> = {};
    if (ctx.activeFile) {
      originals[ctx.activeFile.path] = ctx.activeFile.content;
    }
    for (const f of ctx.attachedFiles) {
      originals[f.path] = f.content;
    }
    const parsed = extractProposedEdits(text, originals);
    const edits: ProposedEdit[] = [];
    for (const edit of parsed) {
      if (!originals[edit.path] && (await this.files.exists(edit.path))) {
        edits.push(await proposeEdit(edit.path, edit.proposed, this.files));
      } else {
        edits.push(edit);
      }
    }
    return { text, edits, provider: this.dispatcher.getLastUsed() };
  }
}
