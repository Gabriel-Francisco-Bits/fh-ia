import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface SkillRecord {
  name: string;
  description: string;
  body: string;
  source: string;
  origin: "project" | "user";
}

export interface SkillScanFs {
  readFile(abs: string): Promise<string>;
  readDir(abs: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
}

export const PROJECT_SKILL_DIRS = [
  ".claude/skills",
  ".grok/skills",
  ".agents/skills",
  ".cursor/skills",
  ".codex/skills",
  ".github/skills",
  ".opencode/skills",
  ".fh-ia/skills",
  ".skills",
  "skills",
];

export const PROJECT_COMMAND_DIRS = [".claude/commands", ".cursor/commands", ".codex/commands"];

export const PROJECT_INSTRUCTION_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  "CODEX.md",
  ".cursorrules",
  ".windsurfrules",
  ".github/copilot-instructions.md",
];

export const USER_SKILL_DIRS = [
  ".claude/skills",
  ".grok/skills",
  ".grok/bundled/skills",
  ".agents/skills",
  ".cursor/skills",
  ".codex/skills",
  ".config/opencode/skills",
];

const SKIP = new Set(["node_modules", ".git", "out", "dist", "coverage"]);

export function createNodeSkillFs(): SkillScanFs {
  return {
    async readFile(abs) {
      return fs.readFile(abs, "utf8");
    },
    async readDir(abs) {
      try {
        const entries = await fs.readdir(abs, { withFileTypes: true });
        return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
      } catch {
        return [];
      }
    },
  };
}

export function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) {
    return { meta: {}, body: text.trim() };
  }
  const end = text.indexOf("\n---", 3);
  if (end < 0) {
    return { meta: {}, body: text.trim() };
  }
  const yaml = text.slice(3, end).replace(/^\r?\n/, "");
  const body = text.slice(end + 4).replace(/^\r?\n/, "").trim();
  return { meta: parseSimpleYaml(yaml), body };
}

function parseSimpleYaml(yaml: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const lines = yaml.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    let value = m[2].trim();
    if (value === ">" || value === "|" || value === ">-" || value === "|-") {
      const folded: string[] = [];
      i++;
      while (i < lines.length && (/^(\s|$)/.test(lines[i]) || lines[i].startsWith("  "))) {
        folded.push(lines[i].trim());
        i++;
      }
      meta[key] = folded.filter(Boolean).join(" ");
      continue;
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
    i++;
  }
  return meta;
}

export function parseSkillMarkdown(raw: string, fallbackName: string, source: string, origin: "project" | "user"): SkillRecord {
  const { meta, body } = parseFrontmatter(raw);
  const name = sanitizeName(meta.name || fallbackName);
  return {
    name,
    description: (meta.description || meta.short_description || "").trim(),
    body,
    source,
    origin,
  };
}

function sanitizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "skill";
}

async function collectSkillFiles(root: string, relDir: string, io: SkillScanFs, origin: "project" | "user", into: Map<string, SkillRecord>): Promise<void> {
  const abs = path.join(root, relDir);
  const stack = [abs];
  while (stack.length) {
    const dir = stack.pop()!;
    const entries = await io.readDir(dir);
    for (const entry of entries) {
      if (SKIP.has(entry.name)) {
        continue;
      }
      const child = path.join(dir, entry.name);
      if (entry.isDirectory) {
        stack.push(child);
        continue;
      }
      const lower = entry.name.toLowerCase();
      const isSkillFile = lower === "skill.md" || lower === "skill.markdown";
      const isMdc = lower.endsWith(".mdc");
      const isMdInSkills = lower.endsWith(".md") && /(?:^|[/\\])(?:skills|commands)[/\\]/i.test(child);
      if (!isSkillFile && !isMdc && !(isMdInSkills && lower !== "readme.md")) {
        continue;
      }
      try {
        const raw = await io.readFile(child);
        const folder = path.basename(path.dirname(child));
        const fallback = isSkillFile ? folder : entry.name.replace(/\.(md|mdc)$/i, "");
        const rel = path.relative(root, child).split(path.sep).join("/");
        const skill = parseSkillMarkdown(raw, fallback, rel, origin);
        const prev = into.get(skill.name);
        if (!prev || (prev.origin === "user" && origin === "project")) {
          into.set(skill.name, skill);
        }
      } catch {
        // skip unreadable
      }
    }
  }
}

export async function discoverSkills(opts: {
  workspaceRoot?: string;
  home?: string;
  fs?: SkillScanFs;
}): Promise<{ skills: SkillRecord[]; instructions: Array<{ path: string; body: string }> }> {
  const io = opts.fs ?? createNodeSkillFs();
  const home = opts.home ?? os.homedir();
  const found = new Map<string, SkillRecord>();
  if (home) {
    for (const dir of USER_SKILL_DIRS) {
      await collectSkillFiles(home, dir, io, "user", found);
    }
  }
  const instructions: Array<{ path: string; body: string }> = [];
  if (opts.workspaceRoot) {
    for (const dir of PROJECT_SKILL_DIRS) {
      await collectSkillFiles(opts.workspaceRoot, dir, io, "project", found);
    }
    for (const dir of PROJECT_COMMAND_DIRS) {
      await collectSkillFiles(opts.workspaceRoot, dir, io, "project", found);
    }
    for (const file of PROJECT_INSTRUCTION_FILES) {
      try {
        const raw = await io.readFile(path.join(opts.workspaceRoot, file));
        if (raw.trim()) {
          instructions.push({ path: file, body: raw.trim().slice(0, 8000) });
        }
      } catch {
        // optional
      }
    }
  }
  return { skills: [...found.values()].sort((a, b) => a.name.localeCompare(b.name)), instructions };
}

export function selectSkillBodies(skills: SkillRecord[], userText: string, maxChars = 20000): SkillRecord[] {
  const text = userText.toLowerCase();
  const slash = text.match(/(^|\s)\/([a-z0-9][a-z0-9._-]*)/g)?.map((s) => s.trim().slice(1)) ?? [];
  const picked: SkillRecord[] = [];
  let used = 0;
  const consider = (skill: SkillRecord): void => {
    if (picked.includes(skill)) {
      return;
    }
    const size = skill.body.length;
    if (used + size > maxChars) {
      return;
    }
    picked.push(skill);
    used += size;
  };
  for (const skill of skills) {
    if (slash.includes(skill.name) || text.includes(`/${skill.name}`) || new RegExp(`\\b${escapeReg(skill.name)}\\b`).test(text)) {
      consider(skill);
    }
  }
  for (const skill of skills) {
    if (!skill.description) {
      continue;
    }
    const tokens = skill.description.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3);
    const hits = tokens.filter((t) => text.includes(t)).length;
    if (hits >= 2 || (tokens.length && tokens.some((t) => t.length > 6 && text.includes(t)))) {
      consider(skill);
    }
  }
  if (picked.length === 0 && skills.length <= 6) {
    for (const skill of skills) {
      consider(skill);
    }
  }
  return picked;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function renderSkillsForPrompt(
  bundle: { skills: SkillRecord[]; instructions: Array<{ path: string; body: string }> },
  userText: string,
): string {
  const parts: string[] = [];
  if (bundle.instructions.length) {
    parts.push("[Project instructions]");
    parts.push("Follow these repo files as standing rules, for every IA backend.");
    for (const file of bundle.instructions) {
      parts.push(`### ${file.path}`);
      parts.push(file.body);
    }
  }
  if (!bundle.skills.length) {
    return parts.join("\n");
  }
  parts.push("[Skills]");
  parts.push(
    "These SKILL.md files belong to THIS agent (fh-ia), not to a single vendor. Use them no matter whether the backend is Claude, Grok, OpenAI, or FCC. If the user types /skill-name or the task matches a description, follow that skill.",
  );
  parts.push("Available skills:");
  for (const skill of bundle.skills) {
    parts.push(`- /${skill.name} (${skill.origin}): ${skill.description || skill.source}`);
  }
  const loaded = selectSkillBodies(bundle.skills, userText);
  for (const skill of loaded) {
    parts.push(`### Skill /${skill.name} — ${skill.source}`);
    if (skill.description) {
      parts.push(skill.description);
    }
    parts.push(skill.body);
  }
  return parts.join("\n");
}
