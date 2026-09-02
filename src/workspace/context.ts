import type { FilePort } from "./files";

export interface ActiveFile {
  path: string;
  content: string;
}

export interface SelectionSpan {
  path: string;
  text: string;
  startLine: number;
  endLine: number;
}

export interface EditorPort {
  activeFile?: ActiveFile;
  selection?: SelectionSpan;
  workspaceRoot?: string;
}

export interface PromptContext {
  activeFile?: ActiveFile;
  selection?: SelectionSpan;
  attachedFiles: Array<{ path: string; content: string }>;
}

export const FILE_MENTION_RE = /@([^\s@]+)/g;

export function parseFileMentions(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(FILE_MENTION_RE)) {
    const p = match[1];
    if (!paths.includes(p)) {
      paths.push(p);
    }
  }
  return paths;
}

export async function gatherContext(
  userText: string,
  editor: EditorPort,
  files?: FilePort,
): Promise<PromptContext> {
  const attachedFiles: Array<{ path: string; content: string }> = [];
  if (files) {
    for (const mention of parseFileMentions(userText)) {
      try {
        const content = await files.read(mention);
        attachedFiles.push({ path: mention, content });
      } catch {
        attachedFiles.push({ path: mention, content: "(unable to read file)" });
      }
    }
  }
  return {
    activeFile: editor.activeFile,
    selection: editor.selection,
    attachedFiles,
  };
}

export function renderContextBlock(ctx: PromptContext): string {
  const parts: string[] = ["[Workspace context]"];
  if (ctx.activeFile) {
    parts.push(`Active file: ${ctx.activeFile.path}`);
    parts.push("```");
    parts.push(ctx.activeFile.content);
    parts.push("```");
  }
  if (ctx.selection) {
    parts.push(
      `Selection (${ctx.selection.path} L${ctx.selection.startLine}-L${ctx.selection.endLine}):`,
    );
    parts.push("```");
    parts.push(ctx.selection.text);
    parts.push("```");
  }
  for (const file of ctx.attachedFiles) {
    parts.push(`Attached @file: ${file.path}`);
    parts.push("```");
    parts.push(file.content);
    parts.push("```");
  }
  return parts.join("\n");
}

export function buildOutboundMessages(
  userText: string,
  ctx: PromptContext,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const contextBlock = renderContextBlock(ctx);
  const userContent =
    ctx.activeFile || ctx.selection || ctx.attachedFiles.length
      ? `${contextBlock}\n\nUser:\n${userText}`
      : userText;
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];
}

export const DEFAULT_SYSTEM_PROMPT = `You are fh-ia, a coding agent inside Visual Studio Code.
Use the provided workspace context (active file, selection, @file attachments).
When you need to change a file, emit a full-file replacement using:
<tool name="propose_edit" path="relative/path">
new file contents
</tool>
When you need to read another file, mention it as @path in a short request, or ask the user.
Keep answers concise and cite file paths.`;
