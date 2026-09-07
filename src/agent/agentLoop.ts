import { ProviderDispatcher } from "../providers/dispatcher";
import type { ChatMessage, StreamSink } from "../providers/types";
import type { FilePort } from "../workspace/files";
import {
  executeTool,
  parseToolCalls,
  renderToolsSystemPrompt,
  type ToolContext,
} from "./tools";
import { createProposedEdit, type ProposedEdit } from "../workspace/edits";

export interface AgentLoopOptions {
  dispatcher: ProviderDispatcher;
  files: FilePort;
  workspaceRoot: string;
  systemPrompt: string;
  history: ChatMessage[];
  userText: string;
  onEvent: StreamSink;
  maxTurns?: number;
}

export interface AgentLoopResult {
  text: string;
  edits: ProposedEdit[];
  history: ChatMessage[];
  turns: number;
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const maxTurns = options.maxTurns ?? 15;
  const toolContext: ToolContext = {
    workspaceRoot: options.workspaceRoot,
    files: options.files,
  };

  const systemWithTools = `${options.systemPrompt}\n\n${renderToolsSystemPrompt()}`;
  const systemMsg: ChatMessage = { role: "system", content: systemWithTools };
  const userMsg: ChatMessage = { role: "user", content: options.userText };

  const sessionTrail: ChatMessage[] = [...options.history, userMsg];
  const activeEdits: ProposedEdit[] = [];
  let turn = 0;
  let finalText = "";
  let finished = false;

  while (turn < maxTurns && !finished) {
    turn++;
    const currentMessages: ChatMessage[] = [systemMsg, ...sessionTrail];

    let currentTurnResponse = "";
    const turnSink: StreamSink = (ev) => {
      if (ev.type === "text") {
        currentTurnResponse += ev.text;
      }
      // Pass through status or meta
      if (ev.type === "status" || ev.type === "meta") {
        options.onEvent(ev);
      }
    };

    options.onEvent({
      type: "status",
      text: turn === 1 ? "Planificando y analizando..." : `Iteración agéntica ${turn}/${maxTurns}...`,
    });

    currentTurnResponse = await options.dispatcher.chat(currentMessages, turnSink);

    const { thought, toolCalls, cleanText } = parseToolCalls(currentTurnResponse);

    if (thought) {
      options.onEvent({ type: "thought", text: thought });
    }

    if (toolCalls.length === 0) {
      // No more tools invoked -> final answer
      finalText = cleanText || currentTurnResponse;
      options.onEvent({ type: "text", text: finalText });
      sessionTrail.push({ role: "assistant", content: currentTurnResponse });
      finished = true;
      break;
    }

    // Append assistant's output with tool calls to trail
    sessionTrail.push({ role: "assistant", content: currentTurnResponse });

    const toolResultOutputs: string[] = [];

    for (const call of toolCalls) {
      options.onEvent({
        type: "tool_call_start",
        id: call.id,
        name: call.name,
        args: call.args,
      });

      options.onEvent({
        type: "status",
        text: `Ejecutando herramienta '${call.name}'...`,
      });

      if (call.name === "apply_diff") {
        const pathArg = String(call.args.path || "");
        if (pathArg) {
          activeEdits.push(
            createProposedEdit(
              pathArg,
              String(call.args.target_content || ""),
              String(call.args.replacement_content || "")
            )
          );
        }
      } else if (call.name === "write_file") {
        const pathArg = String(call.args.path || "");
        if (pathArg) {
          activeEdits.push(
            createProposedEdit(pathArg, "", String(call.args.content || ""))
          );
        }
      }

      const res = await executeTool(call, toolContext);

      options.onEvent({
        type: "tool_call_output",
        id: call.id,
        name: call.name,
        output: res.output,
        isError: res.isError,
      });

      toolResultOutputs.push(
        `<tool_result name="${call.name}">\n${res.output}\n</tool_result>`,
      );

      if (call.name === "finish_task") {
        finished = true;
        finalText = String(call.args.summary || cleanText || "Tarea completada.");
        options.onEvent({ type: "text", text: finalText });
      }
    }

    if (finished) {
      break;
    }

    // Inject tool results back as user observation message
    const observationMessage = `Observaciones de las herramientas:\n${toolResultOutputs.join("\n\n")}`;
    sessionTrail.push({ role: "user", content: observationMessage });
  }

  return {
    text: finalText || "Proceso agéntico completado.",
    edits: activeEdits,
    history: sessionTrail,
    turns: turn,
  };
}
