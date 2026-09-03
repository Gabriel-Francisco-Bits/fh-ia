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
  openFiles?: string[];
}

export interface PromptContext {
  activeFile?: ActiveFile;
  selection?: SelectionSpan;
  attachedFiles: Array<{ path: string; content: string }>;
  workspaceRoot?: string;
  workspaceName?: string;
  tree: string[];
  openFiles: string[];
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
  let tree: string[] = [];
  if (files?.list) {
    try {
      tree = await files.list(180);
    } catch {
      tree = [];
    }
  }
  const workspaceRoot = editor.workspaceRoot;
  const workspaceName = workspaceRoot ? workspaceRoot.replace(/[\\/]+$/, "").split(/[\\/]/).pop() : undefined;
  return {
    activeFile: editor.activeFile,
    selection: editor.selection,
    attachedFiles,
    workspaceRoot,
    workspaceName,
    tree,
    openFiles: editor.openFiles ?? [],
  };
}

export function hasWorkspaceContext(ctx: PromptContext): boolean {
  return Boolean(
    ctx.workspaceRoot ||
      ctx.tree.length ||
      ctx.openFiles.length ||
      ctx.activeFile ||
      ctx.selection ||
      ctx.attachedFiles.length,
  );
}

export function renderContextBlock(ctx: PromptContext): string {
  const parts: string[] = ["[Workspace context]"];
  if (ctx.workspaceRoot) {
    parts.push(`Open folder: ${ctx.workspaceName ?? ctx.workspaceRoot} (${ctx.workspaceRoot})`);
  } else {
    parts.push("Open folder: (none — ask the user to File > Open Folder)");
  }
  if (ctx.openFiles.length) {
    parts.push(`Open editors: ${ctx.openFiles.join(", ")}`);
  }
  if (ctx.tree.length) {
    parts.push("Repo tree:");
    parts.push(ctx.tree.join("\n"));
  }
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
  const userContent = hasWorkspaceContext(ctx)
    ? `${contextBlock}\n\nUser:\n${userText}`
    : userText;
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];
}

export const DEFAULT_SYSTEM_PROMPT = `You are fh-ia, a coding agent inside Visual Studio Code.
Each user turn includes [Workspace context]: the open folder, a repo tree, open editors, the active file, selection, and @file attachments.
If Open folder and Repo tree are present, you CAN see the repo — name files from the tree. Do not claim there is no workspace.
When you need to change a file, emit a full-file replacement using:
<tool name="propose_edit" path="relative/path">
new file contents
</tool>
When you need another file's contents, ask the user to send @path, or work from the tree and active file.
Keep answers concise and cite file paths.`;
