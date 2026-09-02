export const AGENT_MODES = ["ask", "plan", "autonomous"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

export function isAgentMode(value: string): value is AgentMode {
  return (AGENT_MODES as readonly string[]).includes(value);
}

export const MODE_LABELS: Record<AgentMode, string> = {
  ask: "Preguntar",
  plan: "Plan",
  autonomous: "Autónomo",
};

export function systemPromptForMode(mode: AgentMode, base: string): string {
  if (mode === "plan") {
    return `${base}

You are in PLAN mode. Do not emit propose_edit tools or full-file replacements.
Output a numbered plan, the files you would change, and risks. Wait for the user to switch to Ask or Autonomous before editing.`;
  }
  if (mode === "autonomous") {
    return `${base}

You are in AUTONOMOUS mode. Emit propose_edit tools for needed file changes; they will be applied automatically. Prefer complete, correct edits.`;
  }
  return `${base}

You are in ASK mode. Emit propose_edit tools for file changes; the user will Accept or Reject each one.`;
}
