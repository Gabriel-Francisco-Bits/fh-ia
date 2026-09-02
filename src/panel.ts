import * as vscode from "vscode";
import { ChatApp } from "./host";
import type { ProviderId } from "./providers/types";

export class FhIaViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = ChatApp.viewId;

  constructor(private readonly app: ChatApp) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.app.attachSidebar(webviewView);
  }

  reveal(): void {
    this.app.revealSidebar();
  }

  setProvider(id: ProviderId): void {
    this.app.setProvider(id);
  }
}
