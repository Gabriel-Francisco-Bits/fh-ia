import * as vscode from "vscode";
import os from "node:os";
import { AgentSession } from "./agent/session";
import { createTerminalCredentialResolver } from "./auth/resolve";
import { resolveAuthMode, resolveFailover, resolveProviderBundle } from "./config";
import { renderWebviewHtml } from "./panelHtml";
import { ProviderDispatcher } from "./providers/dispatcher";
import { isProviderId, type ProviderId } from "./providers/types";
import { acceptEdit, rejectEdit, type ProposedEdit } from "./workspace/edits";
import type { EditorPort } from "./workspace/context";
import type { FilePort } from "./workspace/files";

export class FhIaViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "fhIa.chatView";
  private view?: vscode.WebviewView;
  private readonly pending = new Map<string, ProposedEdit>();
  private readonly dispatcher: ProviderDispatcher;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.dispatcher = new ProviderDispatcher({
      bundle: this.readBundle(),
      failover: resolveFailover(this.vscodeConfig()),
      credentials: createTerminalCredentialResolver({
        home: os.homedir(),
        env: process.env,
        authMode: () => resolveAuthMode(this.vscodeConfig()),
      }),
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const { webview } = webviewView;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.css"));
    webview.html = renderWebviewHtml({ cspSource: webview.cspSource, scriptUri, styleUri });
    webview.onDidReceiveMessage((msg) => {
      void this.onMessage(msg);
    });
  }

  reveal(): void {
    void vscode.commands.executeCommand(`${FhIaViewProvider.viewId}.focus`);
  }

  setProvider(id: ProviderId): void {
    this.dispatcher.setSelected(id);
    void vscode.workspace.getConfiguration().update("fhIa.provider", id, vscode.ConfigurationTarget.Global);
    this.post({ type: "provider", provider: id });
    void this.postAuthStatus();
  }

  private vscodeConfig() {
    return {
      get: <T>(key: string) => vscode.workspace.getConfiguration().get<T>(key),
    };
  }

  private readBundle() {
    return resolveProviderBundle(this.vscodeConfig());
  }

  private syncDispatcher(): void {
    this.dispatcher.updateBundle({ ...this.readBundle(), selected: this.dispatcher.getSelected() });
    this.dispatcher.updateFailover(resolveFailover(this.vscodeConfig()));
  }

  private async postAuthStatus(): Promise<void> {
    try {
      const resolved = await this.dispatcher.resolveActive();
      this.post({
        type: "authStatus",
        provider: resolved.id,
        source: resolved.authSource,
        kind: resolved.authKind,
      });
    } catch {
      this.post({
        type: "authStatus",
        provider: this.dispatcher.getSelected(),
        source: "none",
        kind: "none",
      });
    }
  }

  private post(msg: unknown): void {
    void this.view?.webview.postMessage(msg);
  }

  private async onMessage(msg: { type?: string; text?: string; provider?: string; id?: string }): Promise<void> {
    if (!msg || !msg.type) {
      return;
    }
    if (msg.type === "ready") {
      this.syncDispatcher();
      this.post({ type: "provider", provider: this.dispatcher.getSelected() });
      await this.postAuthStatus();
      return;
    }
    if (msg.type === "setProvider" && msg.provider && isProviderId(msg.provider)) {
      this.setProvider(msg.provider);
      return;
    }
    if (msg.type === "send" && msg.text) {
      if (msg.provider && isProviderId(msg.provider)) {
        this.dispatcher.setSelected(msg.provider);
      }
      this.syncDispatcher();
      await this.handleSend(msg.text);
      return;
    }
    if (msg.type === "acceptEdit" && msg.id) {
      const edit = this.pending.get(msg.id);
      if (!edit) {
        return;
      }
      await acceptEdit(edit, vscodeFilePort());
      this.pending.delete(msg.id);
      this.post({ type: "editResolved", id: msg.id, action: "accept" });
      return;
    }
    if (msg.type === "rejectEdit" && msg.id) {
      const edit = this.pending.get(msg.id);
      if (!edit) {
        return;
      }
      await rejectEdit(edit);
      this.pending.delete(msg.id);
      this.post({ type: "editResolved", id: msg.id, action: "reject" });
    }
  }

  private async handleSend(text: string): Promise<void> {
    const session = new AgentSession(this.dispatcher, vscodeFilePort(), vscodeEditorPort);
    try {
      const result = await session.send(text, (event) => {
        if (event.type === "text") {
          this.post({ type: "delta", text: event.text });
        } else if (event.type === "status") {
          this.post({ type: "status", text: event.text });
        } else if (event.type === "error") {
          this.post({ type: "error", message: event.error });
        }
      });
      this.post({ type: "provider", provider: result.provider });
      this.post({ type: "assistantDone", text: result.text });
      for (const edit of result.edits) {
        this.pending.set(edit.id, edit);
        this.post({ type: "edit", edit });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: "error", message });
      this.post({ type: "assistantDone", text: "" });
    }
  }
}

function vscodeEditorPort(): EditorPort {
  const ed = vscode.window.activeTextEditor;
  if (!ed) {
    return { workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath };
  }
  const path = vscode.workspace.asRelativePath(ed.document.uri);
  const sel = ed.selection;
  const port: EditorPort = {
    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    activeFile: { path, content: ed.document.getText() },
  };
  if (!sel.isEmpty) {
    port.selection = {
      path,
      text: ed.document.getText(sel),
      startLine: sel.start.line + 1,
      endLine: sel.end.line + 1,
    };
  }
  return port;
}

function vscodeFilePort(): FilePort {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  const resolve = (p: string): vscode.Uri => {
    if (root && !p.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(p)) {
      return vscode.Uri.joinPath(root, p);
    }
    return vscode.Uri.file(p);
  };
  return {
    async read(p) {
      const data = await vscode.workspace.fs.readFile(resolve(p));
      return new TextDecoder().decode(data);
    },
    async write(p, contents) {
      await vscode.workspace.fs.writeFile(resolve(p), new TextEncoder().encode(contents));
    },
    async exists(p) {
      try {
        await vscode.workspace.fs.stat(resolve(p));
        return true;
      } catch {
        return false;
      }
    },
  };
}
