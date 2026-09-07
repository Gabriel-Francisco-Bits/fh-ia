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
import { runValidation } from "./runner";

export interface AgentLoopOptions {
  dispatcher: ProviderDispatcher;
  files: FilePort;
  workspaceRoot: string;
  systemPrompt: string;
  history: ChatMessage[];
  userText: string;
  onEvent: StreamSink;
  maxTurns?: number;
  maxCorrectionRetries?: number;
  disableAutoCorrection?: boolean;
}

export interface AgentLoopResult {
  text: string;
  edits: ProposedEdit[];
  history: ChatMessage[];
  turns: number;
  autoCorrectionRetries: number;
  validationPassed?: boolean;
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const maxTurns = options.maxTurns ?? 15;
  const maxCorrectionRetries = options.maxCorrectionRetries ?? 3;
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
  let hasCodeModifications = false;
  let autoCorrectionRetries = 0;
  let lastValidationPassed: boolean | undefined = undefined;

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
      // Model did not invoke any tools -> attempting to provide final answer
      if (hasCodeModifications && !options.disableAutoCorrection) {
        options.onEvent({
          type: "status",
          text: "Validando tests automáticos...",
        });

        const validation = await runValidation(options.workspaceRoot);

        if (validation.command !== "(Sin runner de validación detectado)") {
          if (!validation.success) {
            lastValidationPassed = false;
            if (autoCorrectionRetries < maxCorrectionRetries) {
              autoCorrectionRetries++;
              const loc = validation.sanitized.location || "tests del proyecto";
              options.onEvent({
                type: "status",
                text: `Error detectado en ${loc}. Auto-corrigiendo (intento ${autoCorrectionRetries}/${maxCorrectionRetries})...`,
              });

              sessionTrail.push({ role: "assistant", content: currentTurnResponse });
              const errorFeedback = `FALLO DE VALIDACIÓN TRAS MODIFICAR CÓDIGO (Intento ${autoCorrectionRetries}/${maxCorrectionRetries}):\n` +
                `Comando: ${validation.command}\n` +
                `Código de salida: ${validation.exitCode}\n` +
                `Diagnóstico:\n${validation.sanitized.cleanTrace}\n\n` +
                `Por favor analiza el error en ${loc} y aplica las correcciones necesarias con apply_diff o write_file.`;

              sessionTrail.push({ role: "user", content: errorFeedback });
              continue; // Next turn
            } else {
              // Exceeded max retries
              options.onEvent({
                type: "status",
                text: `Límite de autocorrección alcanzado (${maxCorrectionRetries} intentos). Solicitando asistencia humana...`,
              });
              finalText = `Se aplicaron cambios, pero la validación falló tras ${maxCorrectionRetries} intentos de autocorrección.\n\n` +
                `Comando: \`${validation.command}\`\n\n` +
                `Error:\n\`\`\`\n${validation.sanitized.cleanTrace}\n\`\`\``;
              options.onEvent({ type: "text", text: finalText });
              finished = true;
              break;
            }
          } else {
            lastValidationPassed = true;
            options.onEvent({
              type: "status",
              text: "Validación de tests exitosa (Green) ✔",
            });
          }
        }
      }

      finalText = cleanText || currentTurnResponse;
      options.onEvent({ type: "text", text: finalText });
      sessionTrail.push({ role: "assistant", content: currentTurnResponse });
      finished = true;
      break;
    }

    // Append assistant's output with tool calls to trail
    sessionTrail.push({ role: "assistant", content: currentTurnResponse });

    const toolResultOutputs: string[] = [];
    let calledFinishTask = false;
    let finishTaskSummary = "";

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
          hasCodeModifications = true;
        }
      } else if (call.name === "write_file") {
        const pathArg = String(call.args.path || "");
        if (pathArg) {
          activeEdits.push(
            createProposedEdit(pathArg, "", String(call.args.content || ""))
          );
          hasCodeModifications = true;
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
        calledFinishTask = true;
        finishTaskSummary = String(call.args.summary || cleanText || call.args.message || "Tarea completada.");
      }
    }

    // If the model called finish_task and we modified code, run Self-Correction validation
    if (calledFinishTask) {
      if (hasCodeModifications && !options.disableAutoCorrection) {
        options.onEvent({
          type: "status",
          text: "Validando tests automáticos...",
        });

        const validation = await runValidation(options.workspaceRoot);

        if (validation.command !== "(Sin runner de validación detectado)") {
          if (!validation.success) {
            lastValidationPassed = false;
            if (autoCorrectionRetries < maxCorrectionRetries) {
              autoCorrectionRetries++;
              const loc = validation.sanitized.location || "tests del proyecto";
              options.onEvent({
                type: "status",
                text: `Error detectado en ${loc}. Auto-corrigiendo (intento ${autoCorrectionRetries}/${maxCorrectionRetries})...`,
              });

              const errorFeedback = `FALLO DE VALIDACIÓN TRAS MODIFICAR CÓDIGO (Intento ${autoCorrectionRetries}/${maxCorrectionRetries}):\n` +
                `Comando: ${validation.command}\n` +
                `Código de salida: ${validation.exitCode}\n` +
                `Diagnóstico:\n${validation.sanitized.cleanTrace}\n\n` +
                `Por favor analiza el error en ${loc} y aplica las correcciones necesarias con apply_diff o write_file.`;

              toolResultOutputs.push(
                `<validation_error>\n${errorFeedback}\n</validation_error>`,
              );

              // Don't finish yet!
              const observationMessage = `Observaciones de las herramientas:\n${toolResultOutputs.join("\n\n")}`;
              sessionTrail.push({ role: "user", content: observationMessage });
              continue; // Next turn to fix the error!
            } else {
              // Exceeded max retries
              options.onEvent({
                type: "status",
                text: `Límite de autocorrección alcanzado (${maxCorrectionRetries} intentos). Solicitando asistencia humana...`,
              });
              finalText = `Se aplicaron cambios, pero la validación falló tras ${maxCorrectionRetries} intentos de autocorrección.\n\n` +
                `Comando: \`${validation.command}\`\n\n` +
                `Error:\n\`\`\`\n${validation.sanitized.cleanTrace}\n\`\`\``;
              options.onEvent({ type: "text", text: finalText });
              finished = true;
              break;
            }
          } else {
            lastValidationPassed = true;
            options.onEvent({
              type: "status",
              text: "Validación de tests exitosa (Green) ✔",
            });
          }
        }
      }

      finished = true;
      finalText = finishTaskSummary;
      options.onEvent({ type: "text", text: finalText });
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
    autoCorrectionRetries,
    validationPassed: lastValidationPassed,
  };
}
