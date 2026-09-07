import path from "node:path";
import type { FilePort } from "./files";
import { estimateTokens, TokenBudgetManager } from "../agent/tokenBudget";

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

export interface ExtractedSymbol {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "enum" | "method";
  line: number;
  signature?: string;
}

export interface ImportDependency {
  moduleSpecifier: string;
  isLocal: boolean;
  importedSymbols: string[];
  raw: string;
}

export interface ResolvedModuleDependency {
  moduleSpecifier: string;
  resolvedPath?: string;
  exportedSymbols: ExtractedSymbol[];
}

export function extractSymbolsFromCode(content: string): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1. Function match
    const fnMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*(<[^>]+>)?\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?/);
    if (fnMatch) {
      const name = fnMatch[1];
      const params = (fnMatch[3] || "").trim();
      const ret = (fnMatch[4] || "").trim();
      const signature = `function ${name}(${params})${ret ? ": " + ret : ""}`;
      symbols.push({ name, kind: "function", line: i + 1, signature });
      continue;
    }

    // 2. Arrow / const function match
    const arrowMatch = line.match(/(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s*)?(?:\(([^)]*)\)|([a-zA-Z0-9_$]+))\s*(?::\s*([^{=>]+))?\s*=>/);
    if (arrowMatch) {
      const name = arrowMatch[1];
      const params = (arrowMatch[2] || arrowMatch[3] || "").trim();
      const ret = (arrowMatch[4] || "").trim();
      const signature = `const ${name} = (${params})${ret ? ": " + ret : ""} => ...`;
      symbols.push({ name, kind: "function", line: i + 1, signature });
      continue;
    }

    // 3. Class match
    const classMatch = line.match(/(?:export\s+)?(?:abstract\s+)?class\s+([a-zA-Z0-9_$]+)(?:\s+extends\s+([a-zA-Z0-9_$.]+))?(?:\s+implements\s+([a-zA-Z0-9_$,\s]+))?/);
    if (classMatch) {
      const name = classMatch[1];
      const ext = classMatch[2] ? ` extends ${classMatch[2]}` : "";
      const impl = classMatch[3] ? ` implements ${classMatch[3]}` : "";
      symbols.push({ name, kind: "class", line: i + 1, signature: `class ${name}${ext}${impl}` });
      continue;
    }

    // 4. Interface match
    const ifaceMatch = line.match(/(?:export\s+)?interface\s+([a-zA-Z0-9_$]+)(?:<[^>]+>)?(?:\s+extends\s+([a-zA-Z0-9_$,\s]+))?/);
    if (ifaceMatch) {
      const name = ifaceMatch[1];
      const ext = ifaceMatch[2] ? ` extends ${ifaceMatch[2]}` : "";
      symbols.push({ name, kind: "interface", line: i + 1, signature: `interface ${name}${ext}` });
      continue;
    }

    // 5. Type alias match
    const typeMatch = line.match(/(?:export\s+)?type\s+([a-zA-Z0-9_$]+)(?:<[^>]+>)?\s*=\s*(.+)/);
    if (typeMatch) {
      const name = typeMatch[1];
      const def = typeMatch[2].trim().slice(0, 60);
      symbols.push({ name, kind: "type", line: i + 1, signature: `type ${name} = ${def}` });
      continue;
    }

    // 6. Enum match
    const enumMatch = line.match(/(?:export\s+)?enum\s+([a-zA-Z0-9_$]+)/);
    if (enumMatch) {
      symbols.push({ name: enumMatch[1], kind: "enum", line: i + 1, signature: `enum ${enumMatch[1]}` });
      continue;
    }
  }
  return symbols;
}

export function extractImportDependencies(content: string): ImportDependency[] {
  const deps: ImportDependency[] = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    // ES import
    const esImportMatch = trimmed.match(/^import\s+(?:([\w*\s{},$]+)\s+from\s+)?['"]([^'"]+)['"]/);
    if (esImportMatch) {
      const symbolsRaw = esImportMatch[1] || "";
      const specifier = esImportMatch[2];
      const isLocal = specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
      const importedSymbols = symbolsRaw
        .replace(/[{}]/g, " ")
        .split(",")
        .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean);
      deps.push({ moduleSpecifier: specifier, isLocal, importedSymbols, raw: trimmed });
      continue;
    }
    // CJS require
    const cjsMatch = trimmed.match(/(?:const|let|var)\s+(?:{([^}]+)}|([a-zA-Z0-9_$]+))\s*=\s*require\(['"]([^'"]+)['"]\)/);
    if (cjsMatch) {
      const specifier = cjsMatch[3];
      const isLocal = specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
      const importedSymbols = cjsMatch[1]
        ? cjsMatch[1].split(",").map((s) => s.trim().split(":")[0].trim()).filter(Boolean)
        : [cjsMatch[2]];
      deps.push({ moduleSpecifier: specifier, isLocal, importedSymbols, raw: trimmed });
    }
  }
  return deps;
}

export async function resolveImportedSymbols(
  activePath: string,
  content: string,
  files?: FilePort,
): Promise<ResolvedModuleDependency[]> {
  if (!files || !activePath) return [];
  const deps = extractImportDependencies(content);
  const resolved: ResolvedModuleDependency[] = [];
  const currentDir = path.dirname(activePath);

  for (const dep of deps) {
    if (!dep.isLocal) continue;
    const baseCandidate = path.posix.normalize(path.posix.join(currentDir, dep.moduleSpecifier));
    const candidates = [
      baseCandidate,
      `${baseCandidate}.ts`,
      `${baseCandidate}.js`,
      `${baseCandidate}.tsx`,
      `${baseCandidate}.jsx`,
      `${baseCandidate}/index.ts`,
      `${baseCandidate}/index.js`,
    ];

    let fileContent = "";
    let foundPath = "";
    for (const cand of candidates) {
      try {
        if (await files.exists(cand)) {
          fileContent = await files.read(cand);
          foundPath = cand;
          break;
        }
      } catch {}
    }

    if (fileContent) {
      const syms = extractSymbolsFromCode(fileContent);
      resolved.push({
        moduleSpecifier: dep.moduleSpecifier,
        resolvedPath: foundPath,
        exportedSymbols: syms,
      });
    }
  }

  return resolved;
}

export async function buildCodeIntelligenceContext(
  activeFile: ActiveFile,
  files?: FilePort,
): Promise<string> {
  const parts: string[] = [];
  const symbols = extractSymbolsFromCode(activeFile.content);
  if (symbols.length > 0) {
    parts.push(`Symbols in ${activeFile.path}:`);
    for (const s of symbols) {
      parts.push(`- [L${s.line}] ${s.signature || `${s.kind} ${s.name}`}`);
    }
  }

  const resolved = await resolveImportedSymbols(activeFile.path, activeFile.content, files);
  if (resolved.length > 0) {
    parts.push(`\nImported Module Signatures & Types:`);
    for (const dep of resolved) {
      parts.push(`From '${dep.moduleSpecifier}' (${dep.resolvedPath || dep.moduleSpecifier}):`);
      for (const s of dep.exportedSymbols.slice(0, 8)) {
        parts.push(`  • ${s.signature || `${s.kind} ${s.name}`}`);
      }
    }
  }

  return parts.join("\n");
}

export interface EditorPort {
  activeFile?: ActiveFile;
  selection?: SelectionSpan;
  workspaceRoot?: string;
  openFiles?: string[];
  gitContext?: string;
  terminalContext?: string;
  symbolsContext?: string;
  docsContext?: string;
  webContext?: string;
  codebaseContext?: string;
}

export interface PromptContext {
  activeFile?: ActiveFile;
  selection?: SelectionSpan;
  attachedFiles: Array<{ path: string; content: string }>;
  workspaceRoot?: string;
  workspaceName?: string;
  tree: string[];
  openFiles: string[];
  gitContext?: string;
  terminalContext?: string;
  symbolsContext?: string;
  docsContext?: string;
  webContext?: string;
  codebaseContext?: string;
}

export const FILE_MENTION_RE = /@([^\s@]+)/g;

export const SPECIAL_MENTIONS = new Set([
  "git",
  "terminal",
  "symbols",
  "docs",
  "web",
  "codebase",
  "problems",
]);

export function parseFileMentions(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(FILE_MENTION_RE)) {
    const p = match[1];
    if (!SPECIAL_MENTIONS.has(p.toLowerCase()) && !paths.includes(p)) {
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

  let symbolsContext = editor.symbolsContext;
  if (!symbolsContext && editor.activeFile) {
    try {
      const intel = await buildCodeIntelligenceContext(editor.activeFile, files);
      if (intel.trim()) {
        symbolsContext = intel;
      }
    } catch {}
  } else if (symbolsContext && editor.activeFile && /@symbols\b/i.test(userText)) {
    try {
      const intel = await buildCodeIntelligenceContext(editor.activeFile, files);
      if (intel.trim() && !symbolsContext.includes("Imported Module Signatures")) {
        symbolsContext = `${symbolsContext}\n\n${intel}`;
      }
    } catch {}
  }

  let docsContext = editor.docsContext;
  if (!docsContext && /@docs\b/i.test(userText)) {
    docsContext = "Framework Documentation: Node.js standard APIs, TypeScript types, Monaco Editor API, ECMAScript 2024.";
  }

  let webContext = editor.webContext;
  if (!webContext && /@web\b/i.test(userText)) {
    webContext = "Web search & documentation lookup enabled.";
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
    gitContext: editor.gitContext,
    terminalContext: editor.terminalContext,
    symbolsContext,
    docsContext,
    webContext,
    codebaseContext: editor.codebaseContext,
  };
}

export function hasWorkspaceContext(ctx: PromptContext): boolean {
  return Boolean(
    ctx.workspaceRoot ||
      ctx.tree.length ||
      ctx.openFiles.length ||
      ctx.activeFile ||
      ctx.selection ||
      ctx.attachedFiles.length ||
      ctx.gitContext ||
      ctx.terminalContext ||
      ctx.symbolsContext ||
      ctx.docsContext ||
      ctx.webContext ||
      ctx.codebaseContext,
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
  if (ctx.gitContext) {
    parts.push("[Git Status & Diff (@git)]");
    parts.push("```diff");
    parts.push(ctx.gitContext);
    parts.push("```");
  }
  if (ctx.terminalContext) {
    parts.push("[Terminal Buffer Output (@terminal)]");
    parts.push("```text");
    parts.push(ctx.terminalContext);
    parts.push("```");
  }
  if (ctx.symbolsContext) {
    parts.push("[Code Symbols (@symbols)]");
    parts.push("```");
    parts.push(ctx.symbolsContext);
    parts.push("```");
  }
  if (ctx.docsContext) {
    parts.push("[Framework Documentation Context (@docs)]");
    parts.push(ctx.docsContext);
  }
  if (ctx.webContext) {
    parts.push("[Live Web Context (@web)]");
    parts.push(ctx.webContext);
  }
  if (ctx.codebaseContext) {
    parts.push("[Codebase Semantic Search Context (@codebase)]");
    parts.push(ctx.codebaseContext);
  }
  return parts.join("\n");
}

export function buildOutboundMessages(
  userText: string,
  ctx: PromptContext,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
  budgetManager?: TokenBudgetManager,
  codeBudget?: number,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  let contextBlock = renderContextBlock(ctx);
  if (budgetManager && typeof codeBudget === "number") {
    contextBlock = budgetManager.pruneContext(contextBlock, codeBudget);
  }
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
Project skills (SKILL.md from Claude, Grok, Cursor, Codex, OpenCode, GitHub Copilot, and similar) are yours. Follow a matching skill for any backend.
When you need to change a file, emit a full-file replacement using:
<tool name="propose_edit" path="relative/path">
new file contents
</tool>
When you need another file's contents, ask the user to send @path, or work from the tree and active file.
Never emit fake tool calls, pseudo-actions, or JSON commands inside propose_edit tags. Only use propose_edit with real file paths.
Keep answers concise and cite file paths.`;
