import * as fs from "node:fs";
import * as path from "node:path";

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "..", "..");
  const extensionTestsPath = path.resolve(__dirname, "vscodeSuite.js");
  const workspace = path.join(extensionDevelopmentPath, "src", "test", "fixtures", "workspace");

  if (!process.env.DISPLAY && process.platform === "linux") {
    throw new Error("No DISPLAY; VS Code Electron cannot start in this environment");
  }

  const { runTests } = await import("@vscode/test-electron");
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspace, "--disable-extensions", "--disable-gpu", "--disable-workspace-trust"],
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  process.stderr.write(message + "\n");
  const marker = path.join(extensionRoot(), "launch-error.txt");
  try {
    fs.writeFileSync(marker, message);
  } catch {
    // ignore
  }
  process.exit(1);
});

function extensionRoot(): string {
  return path.resolve(__dirname, "..", "..");
}
