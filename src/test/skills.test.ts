import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AgentSession } from "../agent/session";
import { ProviderDispatcher } from "../providers/dispatcher";
import {
  discoverSkills,
  parseFrontmatter,
  parseSkillMarkdown,
  renderSkillsForPrompt,
  selectSkillBodies,
} from "../workspace/skills";
import { startSseServer } from "./helpers";

test("parses SKILL.md frontmatter including folded description", () => {
  const skill = parseSkillMarkdown(
    `---
name: review-pr
description: >
  Review pull requests for bugs.
  Use when the user says review the PR.
---
Check the diff and tests.
`,
    "folder",
    ".claude/skills/review-pr/SKILL.md",
    "project",
  );
  assert.equal(skill.name, "review-pr");
  assert.match(skill.description, /Review pull requests/);
  assert.match(skill.body, /Check the diff/);
});

test("parseFrontmatter without yaml returns full body", () => {
  const parsed = parseFrontmatter("# just markdown");
  assert.equal(parsed.meta.name, undefined);
  assert.match(parsed.body, /just markdown/);
});

test("discovers Claude, Grok, Cursor, and Codex skill layouts; project wins over user", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fh-ia-skills-"));
  const home = await mkdtemp(path.join(os.tmpdir(), "fh-ia-home-"));
  await mkdir(path.join(root, ".claude", "skills", "review-pr"), { recursive: true });
  await mkdir(path.join(root, ".grok", "skills", "ship"), { recursive: true });
  await mkdir(path.join(root, ".cursor", "skills", "ui-pass"), { recursive: true });
  await mkdir(path.join(root, ".agents", "skills", "codex-fix"), { recursive: true });
  await mkdir(path.join(home, ".claude", "skills", "review-pr"), { recursive: true });
  await writeFile(
    path.join(home, ".claude", "skills", "review-pr", "SKILL.md"),
    "---\nname: review-pr\ndescription: user copy\n---\nUSER BODY\n",
    "utf8",
  );
  await writeFile(
    path.join(root, ".claude", "skills", "review-pr", "SKILL.md"),
    "---\nname: review-pr\ndescription: project copy\n---\nPROJECT BODY\n",
    "utf8",
  );
  await writeFile(
    path.join(root, ".grok", "skills", "ship", "SKILL.md"),
    "---\nname: ship\ndescription: Ship a release\n---\nRun tests then tag.\n",
    "utf8",
  );
  await writeFile(
    path.join(root, ".cursor", "skills", "ui-pass", "SKILL.md"),
    "---\nname: ui-pass\ndescription: Check UI in the browser\n---\nUse the browser.\n",
    "utf8",
  );
  await writeFile(
    path.join(root, ".agents", "skills", "codex-fix", "SKILL.md"),
    "---\nname: codex-fix\ndescription: Codex-style fix skill\n---\nFix the bug.\n",
    "utf8",
  );
  await writeFile(path.join(root, "AGENTS.md"), "Always write tests.\n", "utf8");

  const bundle = await discoverSkills({ workspaceRoot: root, home });
  const names = bundle.skills.map((s) => s.name).sort();
  assert.deepEqual(names, ["codex-fix", "review-pr", "ship", "ui-pass"]);
  const review = bundle.skills.find((s) => s.name === "review-pr");
  assert.equal(review?.origin, "project");
  assert.match(review?.body ?? "", /PROJECT BODY/);
  assert.equal(bundle.instructions.some((i) => i.path === "AGENTS.md"), true);
});

test("matching /skill-name loads that body for any IA", () => {
  const skills = [
    parseSkillMarkdown("---\nname: ship\ndescription: Ship a release\n---\nTAG IT\n", "ship", "a", "project"),
    parseSkillMarkdown("---\nname: other\ndescription: Unrelated\n---\nNOPE\n", "other", "b", "project"),
  ];
  const loaded = selectSkillBodies(skills, "please /ship this");
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].name, "ship");
  const rendered = renderSkillsForPrompt({ skills, instructions: [] }, "please /ship this");
  assert.match(rendered, /belong to THIS agent/);
  assert.match(rendered, /\/ship/);
  assert.match(rendered, /TAG IT/);
  assert.match(rendered, /\/other/);
});

test("AgentSession injects project skills into Grok payloads", async () => {
  const grok = await startSseServer({ kind: "openai", pathSuffix: "/v1/chat/completions", reply: "ok" });
  const root = await mkdtemp(path.join(os.tmpdir(), "fh-ia-skill-sess-"));
  await mkdir(path.join(root, ".claude", "skills", "review-pr"), { recursive: true });
  await writeFile(
    path.join(root, ".claude", "skills", "review-pr", "SKILL.md"),
    "---\nname: review-pr\ndescription: Review a pull request\n---\nLook at git diff.\n",
    "utf8",
  );
  try {
    const dispatcher = new ProviderDispatcher({
      bundle: {
        selected: "grok",
        claude: { id: "claude", apiKey: "x", baseUrl: "http://127.0.0.1:9", model: "c" },
        grok: { id: "grok", apiKey: "k", baseUrl: grok.url, model: "grok-test" },
        openai: { id: "openai", apiKey: "x", baseUrl: "http://127.0.0.1:9", model: "o" },
        fcc: { id: "fcc", apiKey: "", baseUrl: "http://127.0.0.1:9", model: "f" },
      },
    });
    const files = {
      async read() {
        throw new Error("no");
      },
      async write() {
        throw new Error("no");
      },
      async exists() {
        return false;
      },
    };
    const session = new AgentSession(dispatcher, files, () => ({ workspaceRoot: root }), path.join(root, "no-home"));
    await session.send("review-pr the latest changes", () => undefined, "ask");
    const body = grok.requests[0].body;
    assert.match(body, /\[Skills\]/);
    assert.match(body, /\/review-pr/);
    assert.match(body, /Look at git diff/);
    assert.match(body, /no matter whether the backend is Claude, Grok, OpenAI, or FCC/);
  } finally {
    await grok.close();
  }
});
