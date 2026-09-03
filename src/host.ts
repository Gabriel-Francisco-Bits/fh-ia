import os from "node:os";
import * as vscode from "vscode";
import { AgentSession } from "./agent/session";
import type { AgentMode } from "./agent/modes";
import { isAgentMode } from "./agent/modes";
import { createTerminalCredentialResolver } from "./auth/resolve";
import { capHistory, createChatRecord, titleFromFirstMessage, type ChatRecord } from "./chats";
import {
  resolveAgentMode,
  resolveAuthMode,
  resolveFailover,
  resolveFccEnabled,
  resolveProviderBundle,
  resolveUi,
} from "./config";
import { probeFcc } from "./providers/fcc";
import { MODEL_CATALOG, modelsFor } from "./models";
import { renderWebviewHtml } from "./panelHtml";
import { ProviderDispatcher } from "./providers/dispatcher";
import { isProviderId, type ProviderId } from "./providers/types";
import { acceptEdit, rejectEdit, type ProposedEdit } from "./workspace/edits";
import type { EditorPort } from "./workspace/context";
import type { FilePort } from "./workspace/files";

export const EDITOR_VIEW_TYPE = "fhIa.chatTab";
const STORE_KEY = "fhIa.sessions";

interface StoreShape {
  sessions: ChatRecord[];
  sidebarSessionId?: string;
}

export class ChatApp {
  public static readonly viewId = "fhIa.chatView";
  private readonly dispatcher: ProviderDispatcher;
  private readonly sessions = new Map<string, ChatRecord>();
  private readonly agents = new Map<string, AgentSession>();
  private readonly views = new Map<string, vscode.Webview>();
  private readonly editorPanels = new Map<string, vscode.WebviewPanel>();
  private readonly pending = new Map<string, ProposedEdit>();
  private sidebar?: vscode.WebviewView;
  private sidebarSessionId = "";
  private lastSessionId = "";

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
    this.restore();
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("fhIa")) {
          this.syncDispatcher();
          void this.broadcastConfig();
        }
      }),
      vscode.window.registerWebviewPanelSerializer(EDITOR_VIEW_TYPE, {
        deserializeWebviewPanel: async (panel, state) => {
          const id = (state as { sessionId?: string } | undefined)?.sessionId;
          this.attachEditor(panel, id && this.sessions.has(id) ? id : this.createSession().id);
        },
      }),
    );
  }

  attachSidebar(view: vscode.WebviewView): void {
    this.sidebar = view;
    if (!this.sidebarSessionId || !this.sessions.has(this.sidebarSessionId)) {
      this.sidebarSessionId = this.createSession().id;
    }
    this.setupWebview(view.webview);
    this.bind(view.webview, this.sidebarSessionId);
    view.title = "Chat";
  }

  revealSidebar(): void {
    void vscode.commands.executeCommand(`${ChatApp.viewId}.focus`);
  }

  openNewChat(): void {
    const rec = this.createSession();
    const panel = vscode.window.createWebviewPanel(
      EDITOR_VIEW_TYPE,
      rec.title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.svg");
    this.editorPanels.set(rec.id, panel);
    this.setupWebview(panel.webview);
    this.bind(panel.webview, rec.id);
    panel.onDidDispose(() => {
      this.editorPanels.delete(rec.id);
      if (this.views.get(rec.id) === panel.webview) {
        this.views.delete(rec.id);
      }
    });
  }

  openSettingsUi(): void {
    const webview = this.views.get(this.lastSessionId) ?? [...this.views.values()].at(-1);
    if (webview) {
      void webview.postMessage({ type: "showSettings" });
      return;
    }
    void vscode.commands.executeCommand("workbench.action.openSettings", "@ext:gfh.fh-ia");
  }

  setProvider(id: ProviderId, sessionId?: string): void {
    const rec = this.session(sessionId ?? (this.lastSessionId || this.sidebarSessionId));
    rec.provider = id;
    rec.model = this.readBundle()[id].model;
    rec.updatedAt = Date.now();
    this.dispatcher.setSelected(id);
    void vscode.workspace.getConfiguration().update("fhIa.provider", id, vscode.ConfigurationTarget.Global);
    this.persist();
    this.post(rec.id, { type: "session", session: this.publicSession(rec) });
    this.post(rec.id, { type: "models", models: modelsFor(id, rec.model), provider: id });
    void this.postAuthStatus(rec.id);
  }

  private restore(): void {
    const stored = this.context.workspaceState.get<StoreShape>(STORE_KEY);
    for (const rec of stored?.sessions ?? []) {
      rec.history = capHistory(rec.history ?? []);
      rec.transcript = rec.transcript ?? [];
      this.sessions.set(rec.id, rec);
    }
    if (stored?.sidebarSessionId && this.sessions.has(stored.sidebarSessionId)) {
      this.sidebarSessionId = stored.sidebarSessionId;
    }
  }

  private persist(): void {
    void this.context.workspaceState.update(STORE_KEY, {
      sessions: [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40),
      sidebarSessionId: this.sidebarSessionId,
    } satisfies StoreShape);
  }

  private createSession(): ChatRecord {
    const bundle = this.readBundle();
    const rec = createChatRecord({
      provider: bundle.selected,
      mode: resolveAgentMode(this.vscodeConfig()),
      model: bundle[bundle.selected].model,
    });
    this.sessions.set(rec.id, rec);
    this.persist();
    return rec;
  }

  private session(id: string): ChatRecord {
    const existing = this.sessions.get(id);
    if (existing) {
      return existing;
    }
    const bundle = this.readBundle();
    const rec = createChatRecord({
      id,
      provider: bundle.selected,
      mode: resolveAgentMode(this.vscodeConfig()),
      model: bundle[bundle.selected].model,
    });
    this.sessions.set(rec.id, rec);
    this.persist();
    return rec;
  }

  private agentFor(id: string): AgentSession {
    let agent = this.agents.get(id);
    if (!agent) {
      agent = new AgentSession(this.dispatcher, vscodeFilePort(), vscodeEditorPort);
      const rec = this.sessions.get(id);
      if (rec) {
        agent.setHistory(rec.history);
      }
      this.agents.set(id, agent);
    }
    return agent;
  }

  private setupWebview(webview: vscode.Webview): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.css"));
    webview.html = renderWebviewHtml({ cspSource: webview.cspSource, scriptUri, styleUri });
  }

  private bind(webview: vscode.Webview, sessionId: string): void {
    this.views.set(sessionId, webview);
    this.lastSessionId = sessionId;
    webview.onDidReceiveMessage((msg) => {
      this.lastSessionId = sessionId;
      void this.onMessage(sessionId, msg);
    });
  }

  private vscodeConfig() {
    return {
      get: <T>(key: string) => vscode.workspace.getConfiguration().get<T>(key),
    };
  }

  private readBundle() {
    return resolveProviderBundle(this.vscodeConfig());
  }

  private syncDispatcher(rec?: ChatRecord): void {
    const bundle = this.readBundle();
    if (rec) {
      bundle.selected = rec.provider;
      bundle[rec.provider] = { ...bundle[rec.provider], model: rec.model || bundle[rec.provider].model };
    }
    this.dispatcher.updateBundle(bundle);
    this.dispatcher.updateFailover(resolveFailover(this.vscodeConfig()));
  }

  private publicSession(rec: ChatRecord) {
    return {
      id: rec.id,
      title: rec.title,
      provider: rec.provider,
      model: rec.model,
      mode: rec.mode,
      transcript: rec.transcript,
    };
  }

  private configSnapshot() {
    const bundle = this.readBundle();
    return {
      provider: bundle.selected,
      agentMode: resolveAgentMode(this.vscodeConfig()),
      authMode: resolveAuthMode(this.vscodeConfig()),
      failover: resolveFailover(this.vscodeConfig()),
      claude: { ...bundle.claude, apiKey: bundle.claude.apiKey ? "••••••••" : "" },
      grok: { ...bundle.grok, apiKey: bundle.grok.apiKey ? "••••••••" : "" },
      openai: { ...bundle.openai, apiKey: bundle.openai.apiKey ? "••••••••" : "" },
      fccEnabled: resolveFccEnabled(this.vscodeConfig()),
      fcc: { ...bundle.fcc, apiKey: bundle.fcc.apiKey ? "••••••••" : "" },
      ui: resolveUi(this.vscodeConfig()),
    };
  }

  private post(sessionId: string, msg: unknown): void {
    void this.views.get(sessionId)?.postMessage(msg);
  }

  private async broadcastConfig(): Promise<void> {
    for (const id of this.views.keys()) {
      this.post(id, { type: "config", config: this.configSnapshot() });
      await this.postAuthStatus(id);
    }
  }

  private async postAuthStatus(sessionId: string): Promise<void> {
    const rec = this.sessions.get(sessionId);
    if (rec) {
      this.syncDispatcher(rec);
    }
    try {
      const resolved = await this.dispatcher.resolveActive();
      this.post(sessionId, {
        type: "authStatus",
        provider: resolved.id,
        source: resolved.authSource,
        kind: resolved.authKind,
      });
    } catch {
      this.post(sessionId, {
        type: "authStatus",
        provider: rec?.provider ?? this.dispatcher.getSelected(),
        source: "none",
        kind: "none",
      });
    }
  }

  private async onMessage(
    sessionId: string,
    msg: {
      type?: string;
      text?: string;
      provider?: string;
      model?: string;
      mode?: string;
      id?: string;
      settings?: Record<string, unknown>;
    },
  ): Promise<void> {
    if (!msg?.type) {
      return;
    }
    const rec = this.session(sessionId);
    if (msg.type === "ready") {
      this.syncDispatcher(rec);
      this.post(sessionId, {
        type: "init",
        session: this.publicSession(rec),
        config: this.configSnapshot(),
        models: modelsFor(rec.provider, rec.model),
        catalog: MODEL_CATALOG,
      });
      await this.postAuthStatus(sessionId);
      void this.postFccStatus(sessionId);
      return;
    }
    if (msg.type === "newChat") {
      this.openNewChat();
      return;
    }
    if (msg.type === "openVsCodeSettings") {
      void vscode.commands.executeCommand("workbench.action.openSettings", "@ext:gfh.fh-ia");
      return;
    }
    if (msg.type === "setProvider" && msg.provider && isProviderId(msg.provider)) {
      this.setProvider(msg.provider, sessionId);
      return;
    }
    if (msg.type === "setModel" && msg.model) {
      rec.model = msg.model;
      rec.updatedAt = Date.now();
      void vscode.workspace
        .getConfiguration()
        .update(`fhIa.${rec.provider}.model`, msg.model, vscode.ConfigurationTarget.Global);
      this.persist();
      this.post(sessionId, { type: "session", session: this.publicSession(rec) });
      return;
    }
    if (msg.type === "setMode" && msg.mode && isAgentMode(msg.mode)) {
      rec.mode = msg.mode;
      rec.updatedAt = Date.now();
      void vscode.workspace.getConfiguration().update("fhIa.agentMode", msg.mode, vscode.ConfigurationTarget.Global);
      this.persist();
      this.post(sessionId, { type: "session", session: this.publicSession(rec) });
      return;
    }
    if (msg.type === "saveSettings" && msg.settings) {
      await this.saveSettings(msg.settings);
      this.syncDispatcher(rec);
      this.post(sessionId, { type: "config", config: this.configSnapshot() });
      this.post(sessionId, { type: "settingsSaved" });
      await this.postAuthStatus(sessionId);
      void this.postFccStatus(sessionId);
      return;
    }
    if (msg.type === "send" && msg.text) {
      if (msg.provider && isProviderId(msg.provider)) {
        rec.provider = msg.provider;
      }
      await this.handleSend(rec, msg.text);
      return;
    }
    if (msg.type === "acceptEdit" && msg.id) {
      const edit = this.pending.get(msg.id);
      if (!edit) {
        return;
      }
      await acceptEdit(edit, vscodeFilePort());
      this.pending.delete(msg.id);
      this.post(sessionId, { type: "editResolved", id: msg.id, action: "accept" });
      return;
    }
    if (msg.type === "rejectEdit" && msg.id) {
      const edit = this.pending.get(msg.id);
      if (!edit) {
        return;
      }
      await rejectEdit(edit);
      this.pending.delete(msg.id);
      this.post(sessionId, { type: "editResolved", id: msg.id, action: "reject" });
    }
  }

  private async saveSettings(raw: Record<string, unknown>): Promise<void> {
    const cfg = vscode.workspace.getConfiguration();
    const set = async (key: string, value: unknown) => {
      if (value === undefined) {
        return;
      }
      await cfg.update(key, value, vscode.ConfigurationTarget.Global);
    };
    if (typeof raw.provider === "string" && isProviderId(raw.provider)) {
      await set("fhIa.provider", raw.provider);
    }
    if (typeof raw.agentMode === "string" && isAgentMode(raw.agentMode)) {
      await set("fhIa.agentMode", raw.agentMode);
    }
    if (typeof raw.authMode === "string") {
      await set("fhIa.authMode", raw.authMode);
    }
    if (typeof raw.failoverEnabled === "boolean") {
      await set("fhIa.failover.enabled", raw.failoverEnabled);
    }
    if (typeof raw.failoverOrder === "string") {
      await set("fhIa.failover.order", raw.failoverOrder);
    }
    if (typeof raw.fccEnabled === "boolean") {
      await set("fhIa.fcc.enabled", raw.fccEnabled);
    }
    if (typeof raw.theme === "string") {
      await set("fhIa.ui.theme", raw.theme);
    }
    if (typeof raw.fontSize === "number" || (typeof raw.fontSize === "string" && raw.fontSize.trim())) {
      await set("fhIa.ui.fontSize", Number(raw.fontSize));
    }
    if (typeof raw.iconSize === "number" || (typeof raw.iconSize === "string" && raw.iconSize.trim())) {
      await set("fhIa.ui.iconSize", Number(raw.iconSize));
    }
    if (typeof raw.accent === "string") {
      await set("fhIa.ui.accent", raw.accent);
    }
    if (typeof raw.userBubble === "string") {
      await set("fhIa.ui.userBubble", raw.userBubble);
    }
    if (typeof raw.assistantBubble === "string") {
      await set("fhIa.ui.assistantBubble", raw.assistantBubble);
    }
    for (const id of ["claude", "grok", "openai", "fcc"] as const) {
      const block = raw[id];
      if (!block || typeof block !== "object") {
        continue;
      }
      const b = block as { model?: string; baseUrl?: string; apiKey?: string };
      if (typeof b.model === "string" && b.model.trim()) {
        await set(`fhIa.${id}.model`, b.model.trim());
      }
      if (typeof b.baseUrl === "string" && b.baseUrl.trim()) {
        await set(`fhIa.${id}.baseUrl`, b.baseUrl.trim());
      }
      if (typeof b.apiKey === "string" && b.apiKey.trim() && !b.apiKey.includes("•")) {
        await set(`fhIa.${id}.apiKey`, b.apiKey.trim());
      }
    }
  }

  private async postFccStatus(sessionId: string): Promise<void> {
    const enabled = resolveFccEnabled(this.vscodeConfig());
    const fcc = this.readBundle().fcc;
    if (!enabled) {
      this.post(sessionId, { type: "fccStatus", ok: false, enabled: false, models: [] });
      return;
    }
    const probe = await probeFcc({ baseUrl: fcc.baseUrl, apiKey: fcc.apiKey });
    if (probe.models.length) {
      this.post(sessionId, {
        type: "models",
        provider: "fcc",
        models: modelsFor("fcc", fcc.model).concat(probe.models.filter((m) => m !== fcc.model)),
      });
    }
    this.post(sessionId, {
      type: "fccStatus",
      ok: probe.ok,
      enabled: true,
      models: probe.models,
      error: probe.error,
    });
  }

  private attachEditor(panel: vscode.WebviewPanel, sessionId: string): void {
    this.editorPanels.set(sessionId, panel);
    this.setupWebview(panel.webview);
    this.bind(panel.webview, sessionId);
    const rec = this.sessions.get(sessionId);
    if (rec) {
      panel.title = rec.title;
    }
    panel.onDidDispose(() => {
      this.editorPanels.delete(sessionId);
    });
  }

  private async handleSend(rec: ChatRecord, text: string): Promise<void> {
    this.syncDispatcher(rec);
    rec.transcript.push({ role: "user", text });
    if (rec.title === "Nuevo chat") {
      rec.title = titleFromFirstMessage(text);
      const panel = this.editorPanels.get(rec.id);
      if (panel) {
        panel.title = rec.title;
      }
    }
    rec.updatedAt = Date.now();
    this.persist();
    const session = this.agentFor(rec.id);
    session.setHistory(rec.history);
    try {
      const result = await session.send(text, (event) => {
        if (event.type === "text") {
          this.post(rec.id, { type: "delta", text: event.text });
        } else if (event.type === "status") {
          this.post(rec.id, { type: "status", text: event.text });
        } else if (event.type === "error") {
          this.post(rec.id, { type: "error", message: event.error });
        }
      }, rec.mode);
      rec.history = result.history;
      rec.transcript.push({ role: "assistant", text: result.text });
      rec.provider = isProviderId(result.provider) ? result.provider : rec.provider;
      rec.updatedAt = Date.now();
      this.persist();
      this.post(rec.id, { type: "provider", provider: result.provider });
      this.post(rec.id, { type: "assistantDone", text: result.text });
      this.post(rec.id, { type: "session", session: this.publicSession(rec) });
      if (rec.mode === "plan") {
        for (const edit of result.plannedEdits) {
          this.post(rec.id, { type: "edit", edit, apply: "plan" });
        }
        return;
      }
      for (const edit of result.edits) {
        this.pending.set(edit.id, edit);
        if (rec.mode === "autonomous") {
          await acceptEdit(edit, vscodeFilePort());
          this.pending.delete(edit.id);
          this.post(rec.id, { type: "edit", edit, apply: "auto" });
          this.post(rec.id, { type: "editResolved", id: edit.id, action: "accept" });
        } else {
          this.post(rec.id, { type: "edit", edit, apply: "ask" });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      rec.transcript.push({ role: "error", text: message });
      this.persist();
      this.post(rec.id, { type: "error", message });
      this.post(rec.id, { type: "assistantDone", text: "" });
    }
  }
}

function vscodeEditorPort(): EditorPort {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const openFiles = [
    ...new Set(
      vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .map((tab) => {
          const input = tab.input as { uri?: vscode.Uri } | undefined;
          return input?.uri?.scheme === "file" ? vscode.workspace.asRelativePath(input.uri) : "";
        })
        .filter(Boolean),
    ),
  ];
  const ed = vscode.window.activeTextEditor;
  if (!ed) {
    return { workspaceRoot: root, openFiles };
  }
  const path = vscode.workspace.asRelativePath(ed.document.uri);
  const sel = ed.selection;
  const port: EditorPort = {
    workspaceRoot: root,
    openFiles,
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
    async list(max = 180) {
      if (!root) {
        return [];
      }
      const uris = await vscode.workspace.findFiles(
        "**/*",
        "{**/node_modules/**,**/.git/**,**/out/**,**/dist/**,**/coverage/**,**/.vscode-test/**,**/.cache/**}",
        max,
      );
      const files = uris.map((u) => vscode.workspace.asRelativePath(u));
      const dirs = new Set<string>();
      for (const file of files) {
        const parts = file.split(/[\\/]/);
        for (let i = 0; i < parts.length - 1; i++) {
          dirs.add(`${parts.slice(0, i + 1).join("/")}/`);
        }
      }
      return [...dirs, ...files].sort((a, b) => a.localeCompare(b));
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
