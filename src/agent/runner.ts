import path from "node:path";

export interface RunnerDetection {
  type: "node" | "flutter" | "rust" | "python" | "go" | "custom" | "none";
  buildCmd?: string;
  testCmd?: string;
  fullCmd: string;
  manifest: string;
  detected: boolean;
}

export interface SanitizedError {
  cleanTrace: string;
  location?: string;
  file?: string;
  line?: number;
  column?: number;
  errorSummary: string;
}

export interface ValidationResult {
  success: boolean;
  exitCode: number;
  command: string;
  rawOutput: string;
  sanitized: SanitizedError;
  durationMs: number;
}

// Lazy-loaded runner module to support running both in bundled VS Code and Node CLI/tests
let runnerModule: {
  detectRunner: (root: string) => Promise<RunnerDetection>;
  sanitizeErrorOutput: (raw: string, root?: string) => SanitizedError;
  runValidation: (root: string, opts?: { timeoutMs?: number; commandOverride?: string }) => Promise<ValidationResult>;
} | null = null;

function getRunnerModule() {
  if (!runnerModule) {
    try {
      // Intentar cargar desde fh-code en tiempo de ejecución
      const runnerPath = path.resolve(__dirname, "../../fh-code/runner.js");
      runnerModule = require(runnerPath);
    } catch {
      try {
        const altPath = path.resolve(process.cwd(), "fh-code/runner.js");
        runnerModule = require(altPath);
      } catch (e) {
        throw new Error(`No se pudo cargar fh-code/runner.js: ${(e as Error).message}`);
      }
    }
  }
  return runnerModule!;
}

export async function detectRunner(workspaceRoot: string): Promise<RunnerDetection> {
  return getRunnerModule().detectRunner(workspaceRoot);
}

export function sanitizeErrorOutput(rawOutput: string, workspaceRoot?: string): SanitizedError {
  return getRunnerModule().sanitizeErrorOutput(rawOutput, workspaceRoot);
}

export async function runValidation(
  workspaceRoot: string,
  options?: { timeoutMs?: number; commandOverride?: string },
): Promise<ValidationResult> {
  return getRunnerModule().runValidation(workspaceRoot, options);
}
