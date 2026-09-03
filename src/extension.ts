import * as vscode from "vscode";
import { ChatApp } from "./host";
import { FhIaViewProvider } from "./panel";

export function activate(context: vscode.ExtensionContext): void {
  const app = new ChatApp(context);
  const provider = new FhIaViewProvider(app);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(FhIaViewProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("fhIa.openPanel", () => {
      provider.reveal();
    }),
    vscode.commands.registerCommand("fhIa.newChat", () => {
      app.openNewChat();
    }),
    vscode.commands.registerCommand("fhIa.openInTab", () => {
      app.openNewChat();
    }),
    vscode.commands.registerCommand("fhIa.openSettings", () => {
      app.openSettingsUi();
    }),
    vscode.commands.registerCommand("fhIa.selectClaude", () => provider.setProvider("claude")),
    vscode.commands.registerCommand("fhIa.selectGrok", () => provider.setProvider("grok")),
    vscode.commands.registerCommand("fhIa.selectOpenAI", () => provider.setProvider("openai")),
    vscode.commands.registerCommand("fhIa.selectFcc", () => provider.setProvider("fcc")),
  );
}

export function deactivate(): void {
  // nothing to tear down beyond subscriptions
}
