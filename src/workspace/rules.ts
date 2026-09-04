import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as fssync from "node:fs";

export interface RulesResult {
  workspaceRules: { file: string; content: string }[];
  globalRules: { file: string; content: string } | null;
  combined: string;
}

export const WORKSPACE_RULES_FILES = [
  ".cursorrules",
  ".fhrules",
  "rules.md",
  "fh-rules.md",
  "AGENTS.md",
  "GEMINI.md",
  "CLAUDE.md",
  ".github/copilot-instructions.md",
];

export async function discoverRules(options: {
  workspaceRoot?: string;
  home?: string;
}): Promise<RulesResult> {
  const workspaceRules: { file: string; content: string }[] = [];
  let globalRules: { file: string; content: string } | null = null;

  if (options.workspaceRoot) {
    for (const rel of WORKSPACE_RULES_FILES) {
      const full = path.join(options.workspaceRoot, rel);
      try {
        if (fssync.existsSync(full) && fssync.statSync(full).isFile()) {
          const raw = await fs.readFile(full, "utf8");
          const trimmed = raw.trim();
          if (trimmed) {
            workspaceRules.push({ file: rel, content: trimmed });
          }
        }
      } catch {
        // ignore unreadable files
      }
    }

    // Check .cursor/rules directory if it exists
    const cursorRulesDir = path.join(options.workspaceRoot, ".cursor", "rules");
    try {
      if (fssync.existsSync(cursorRulesDir) && fssync.statSync(cursorRulesDir).isDirectory()) {
        const entries = await fs.readdir(cursorRulesDir);
        for (const file of entries) {
          if (file.endsWith(".md") || file.endsWith(".txt") || file.endsWith(".rules")) {
            const p = path.join(cursorRulesDir, file);
            const raw = await fs.readFile(p, "utf8");
            const trimmed = raw.trim();
            if (trimmed) {
              workspaceRules.push({ file: `.cursor/rules/${file}`, content: trimmed });
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  if (options.home) {
    const globalCandidates = [
      path.join(options.home, ".config", "fh-code", "rules.md"),
      path.join(options.home, ".fh-ia", "rules.md"),
      path.join(options.home, ".cursorrules"),
    ];
    for (const gpath of globalCandidates) {
      try {
        if (fssync.existsSync(gpath) && fssync.statSync(gpath).isFile()) {
          const raw = await fs.readFile(gpath, "utf8");
          const trimmed = raw.trim();
          if (trimmed) {
            globalRules = { file: gpath, content: trimmed };
            break;
          }
        }
      } catch {
        // ignore
      }
    }
  }

  const parts: string[] = [];
  if (globalRules) {
    parts.push(`## Reglas Globales del Usuario\n${globalRules.content}`);
  }
  for (const r of workspaceRules) {
    parts.push(`## Reglas del Proyecto (${r.file})\n${r.content}`);
  }

  return {
    workspaceRules,
    globalRules,
    combined: parts.join("\n\n"),
  };
}

export function renderRulesForPrompt(rules: RulesResult): string {
  if (!rules.combined || !rules.combined.trim()) {
    return "";
  }
  return [
    "# Instrucciones y Reglas de Codificación del Repositorio",
    "Sigue estrictamente estas pautas arquitectónicas, estándares de estilo y restricciones del proyecto:",
    "",
    rules.combined.trim(),
  ].join("\n");
}
