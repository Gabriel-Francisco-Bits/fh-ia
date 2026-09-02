import * as vscode from "vscode";

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension("gfh.fh-ia");
  if (!ext) {
    throw new Error("Extension gfh.fh-ia was not found in the development host");
  }
  await ext.activate();
  if (!ext.isActive) {
    throw new Error("Extension gfh.fh-ia failed to activate");
  }
  await vscode.commands.executeCommand("fhIa.openPanel");
  const commands = await vscode.commands.getCommands(true);
  if (!commands.includes("fhIa.openPanel")) {
    throw new Error("fhIa.openPanel is not registered");
  }
  if (!commands.includes("workbench.view.extension.fhIa") && !commands.includes("fhIa.chatView.focus")) {
    // focusing the custom view is enough; some hosts only register *.focus after the view exists
    await vscode.commands.executeCommand("fhIa.chatView.focus");
  }
}
