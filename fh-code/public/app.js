/* fh-code — Monaco (VS Code engine) + fh-ia (Claude, Grok, OpenAI, FCC) */
(function () {
  // Elements
  const treeEl = document.getElementById("tree");
  const tabsEl = document.getElementById("tabs");
  const messagesEl = document.getElementById("messages");
  const inputEl = document.getElementById("input");
  const providerEl = document.getElementById("provider");
  const modelEl = document.getElementById("model");
  const modeEl = document.getElementById("mode");
  const wsName = document.getElementById("ws-name");

  // Titlebar & Actions
  const btnOpenFolder = document.getElementById("btn-open-folder");
  const btnQuickOpen = document.getElementById("btn-quick-open");
  const btnCmdPalette = document.getElementById("btn-cmd-palette");
  const btnToggleTerminal = document.getElementById("btn-toggle-terminal");
  const btnOpenSettings = document.getElementById("btn-open-settings");
  const btnRefreshTree = document.getElementById("btn-refresh-tree");

  // Activity Bar & Sidebar
  const actFiles = document.getElementById("act-files");
  const actSearch = document.getElementById("act-search");
  const actGit = document.getElementById("act-git");
  const actTerminal = document.getElementById("act-terminal");
  const actSettings = document.getElementById("act-settings");
  const actChat = document.getElementById("act-chat");
  const sidebarTitle = document.getElementById("sidebar-title");
  const treeContainer = document.getElementById("tree-container");
  const searchContainer = document.getElementById("search-container");
  const searchInput = document.getElementById("search-input");
  const searchCase = document.getElementById("search-case");
  const searchResults = document.getElementById("search-results");

  // Bottom Panel (Terminal & Git)
  const bottomPanel = document.getElementById("bottom-panel");
  const ptabTerminal = document.getElementById("ptab-terminal");
  const ptabGit = document.getElementById("ptab-git");
  const btnClearTerm = document.getElementById("btn-clear-term");
  const btnClosePanel = document.getElementById("btn-close-panel");
  const panelTerminal = document.getElementById("panel-terminal");
  const panelGit = document.getElementById("panel-git");
  const termOutput = document.getElementById("term-output");
  const termInput = document.getElementById("term-input");
  const gitBranch = document.getElementById("git-branch");
  const btnGitRefresh = document.getElementById("btn-git-refresh");
  const btnGitStageAll = document.getElementById("btn-git-stage-all");
  const gitMessage = document.getElementById("git-message");
  const btnGitCommit = document.getElementById("btn-git-commit");
  const gitFileLists = document.getElementById("git-file-lists");

  // Modals
  const paletteModal = document.getElementById("palette-modal");
  const paletteInput = document.getElementById("palette-input");
  const paletteList = document.getElementById("palette-list");
  const folderModal = document.getElementById("folder-modal");
  const folderInput = document.getElementById("folder-input");
  const btnFolderCancel = document.getElementById("btn-folder-cancel");
  const btnFolderConfirm = document.getElementById("btn-folder-confirm");
  const settingsModal = document.getElementById("settings-modal");
  const btnSettingsClose = document.getElementById("btn-settings-close");
  const btnSettingsCancel = document.getElementById("btn-settings-cancel");
  const btnSettingsSave = document.getElementById("btn-settings-save");
  const btnSettingsReset = document.getElementById("btn-settings-reset");

  // State
  const openTabs = [];
  let activeTabType = "file"; // "file" | "chat"
  let activePath = "";
  let activeChatThreadId = "";
  let editor = null;
  let diffEditor = null;
  let isDiffMode = false;
  let catalog = {};
  let streaming = false;
  let allWorkspaceFiles = [];
  let paletteMode = "files"; // "files" | "commands"
  let paletteItems = [];
  let paletteSelectedIndex = 0;
  let termHistoryIndex = -1;
  const termHistory = [];
  let termEventSource = null;
  let lspTimeout = null;

  // Chat Document View & History Sidebar elements
  const editorEl = document.getElementById("editor");
  const chatDocView = document.getElementById("chat-doc-view");
  const chatDocTitle = document.getElementById("chat-doc-title");
  const btnRenameChatDoc = document.getElementById("btn-rename-chat-doc");
  const btnDeleteChatDoc = document.getElementById("btn-delete-chat-doc");
  const chatSidebarList = document.getElementById("chat-sidebar-list");
  const chatSearchInput = document.getElementById("chat-search-input");

  // Responsive Layout
  function applyShellLayout() {
    const spec = (globalThis.FhCodeLayout && globalThis.FhCodeLayout.layoutForWidth)
      ? globalThis.FhCodeLayout.layoutForWidth(window.innerWidth)
      : { columns: "240px minmax(0, 1fr) 360px", chatDisplay: "flex" };
    const shell = document.querySelector(".shell");
    const chat = document.querySelector(".chat");
    if (shell) shell.style.gridTemplateColumns = spec.columns;
    if (chat) chat.style.display = spec.chatDisplay;
  }
  window.addEventListener("resize", () => {
    applyShellLayout();
    if (editor) editor.layout();
    if (diffEditor) diffEditor.layout();
  });
  applyShellLayout();

  function langOf(p) {
    const ext = (p.split(".").pop() || "").toLowerCase();
    const map = {
      ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
      json: "json", md: "markdown", css: "css", html: "html", py: "python",
      rs: "rust", go: "go", sh: "shell", bash: "shell", yml: "yaml", yaml: "yaml", svg: "xml",
      txt: "plaintext",
    };
    return map[ext] || "plaintext";
  }

  function fillModels() {
    const id = providerEl.value;
    const list = (catalog[id] || []).slice();
    modelEl.innerHTML = "";
    list.forEach((m) => {
      const o = document.createElement("option");
      o.value = m;
      o.textContent = m;
      modelEl.appendChild(o);
    });
    if (list.length) modelEl.value = list[0];
  }

  async function loadMeta() {
    const meta = await (await fetch("/api/meta")).json();
    wsName.textContent = meta.name + " — " + meta.root;
    wsName.title = meta.root;
    catalog = meta.models || {};
    providerEl.value = meta.provider || "grok";
    fillModels();
    applySettingsToUi(meta.settings || {});
    await loadTree(".", treeEl);
    scanAllFiles();
  }

  // File Tree
  async function loadTree(dir, into) {
    const data = await (await fetch("/api/tree?dir=" + encodeURIComponent(dir))).json();
    into.innerHTML = "";
    for (const ent of data.entries || []) {
      const btn = document.createElement("button");
      btn.textContent = (ent.dir ? "▸ " : "  ") + ent.name;
      btn.className = ent.dir ? "dir" : "file";
      const nested = document.createElement("div");
      nested.className = "nested";
      let open = false;
      btn.addEventListener("click", async () => {
        if (ent.dir) {
          open = !open;
          btn.textContent = (open ? "▾ " : "▸ ") + ent.name;
          if (open) await loadTree(ent.path, nested);
          else nested.innerHTML = "";
        } else {
          openFile(ent.path);
        }
      });
      into.appendChild(btn);
      if (ent.dir) into.appendChild(nested);
    }
  }

  async function scanAllFiles(dir = ".") {
    try {
      const data = await (await fetch("/api/tree?dir=" + encodeURIComponent(dir))).json();
      if (dir === ".") allWorkspaceFiles = [];
      for (const ent of data.entries || []) {
        if (ent.dir) {
          await scanAllFiles(ent.path);
        } else {
          allWorkspaceFiles.push(ent.path);
        }
      }
    } catch {
      // ignore
    }
  }

  // Tabs Management (Issue #9 & Chat Documents)
  function renderTabs() {
    tabsEl.innerHTML = "";
    openTabs.forEach((t) => {
      const b = document.createElement("button");
      const isChat = t.type === "chat";
      const isActive = isChat
        ? (activeTabType === "chat" && activeChatThreadId === t.threadId)
        : (activeTabType === "file" && activePath === t.path);
      b.className = "tab" + (isActive ? " active" : "");

      const icon = document.createElement("span");
      icon.style.marginRight = "6px";
      icon.textContent = isChat ? "💬" : "📄";
      b.appendChild(icon);

      const label = document.createElement("span");
      label.textContent = isChat ? (t.title || "Nuevo chat") : (t.path ? t.path.split("/").pop() : "Archivo");
      b.appendChild(label);

      if (!isChat && t.isDirty) {
        const dot = document.createElement("span");
        dot.className = "dirty-dot";
        dot.title = "Archivo modificado no guardado";
        b.appendChild(dot);
      }

      const closeBtn = document.createElement("span");
      closeBtn.className = "tab-close";
      closeBtn.textContent = "✕";
      closeBtn.title = "Cerrar pestaña (Ctrl+W)";
      closeBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeTab(t.id || t.path);
      });
      b.appendChild(closeBtn);

      b.addEventListener("click", () => {
        if (isChat) {
          openChatTab(t.threadId);
        } else {
          openFile(t.path);
        }
      });
      tabsEl.appendChild(b);
    });
  }

  async function openFile(p) {
    if (isDiffMode) closeDiffView();
    activeTabType = "file";
    activePath = p;

    let tab = openTabs.find((t) => t.type !== "chat" && t.path === p);
    if (!tab) {
      const data = await (await fetch("/api/file?path=" + encodeURIComponent(p))).json();
      const content = data.content ?? "";
      let model = null;
      if (typeof monaco !== "undefined") {
        const uri = monaco.Uri.parse(`file:///${p}`);
        model = monaco.editor.getModel(uri) || monaco.editor.createModel(content, langOf(p), uri);
      }
      tab = {
        type: "file",
        id: p,
        path: p,
        content: content,
        savedContent: content,
        model: model,
        isDirty: false,
      };
      openTabs.push(tab);

      if (model) {
        model.onDidChangeContent(() => {
          const cur = model.getValue();
          const dirty = cur !== tab.savedContent;
          if (dirty !== tab.isDirty) {
            tab.isDirty = dirty;
            renderTabs();
          }
          triggerLspDiagnostics(p, cur, langOf(p), model);
        });
      }
    }

    renderTabs();

    if (chatDocView) chatDocView.style.display = "none";
    if (editorEl) editorEl.style.display = "block";

    if (editor && tab.model) {
      editor.setModel(tab.model);
      triggerLspDiagnostics(p, tab.model.getValue(), langOf(p), tab.model);
    }

    document.querySelectorAll(".tree .file").forEach((el) => {
      const leafName = p.split("/").pop();
      el.classList.toggle("active", el.textContent.trim() === leafName);
    });
    if (typeof renderChatSidebar === "function") renderChatSidebar();
  }

  function openChatTab(threadId) {
    if (isDiffMode) closeDiffView();
    activeTabType = "chat";
    activeChatThreadId = threadId;

    const thread = (chatThreads || []).find((t) => t.id === threadId);
    if (!thread) return;

    let tab = openTabs.find((t) => t.type === "chat" && t.threadId === threadId);
    if (!tab) {
      tab = {
        type: "chat",
        id: "chat:" + threadId,
        threadId: threadId,
        title: thread.title || "Nuevo chat",
      };
      openTabs.push(tab);
    }

    renderTabs();

    if (editorEl) editorEl.style.display = "none";
    if (chatDocView) chatDocView.style.display = "flex";

    if (chatDocTitle) chatDocTitle.textContent = thread.title || "Nuevo chat";
    if (typeof renderCurrentThreadMessages === "function") renderCurrentThreadMessages();
    if (typeof renderChatSidebar === "function") renderChatSidebar();
    if (inputEl) inputEl.focus();
  }

  function closeTab(id) {
    const idx = openTabs.findIndex((t) => (t.id || t.path) === id || t.path === id || t.threadId === id);
    if (idx === -1) return;
    const closedTab = openTabs[idx];
    openTabs.splice(idx, 1);

    const wasActive = closedTab.type === "chat"
      ? (activeTabType === "chat" && activeChatThreadId === closedTab.threadId)
      : (activeTabType === "file" && activePath === closedTab.path);

    if (wasActive) {
      if (openTabs.length > 0) {
        const next = openTabs[Math.max(0, idx - 1)];
        if (next.type === "chat") {
          openChatTab(next.threadId);
        } else {
          openFile(next.path);
        }
      } else {
        activeTabType = "file";
        activePath = "";
        renderTabs();
        if (chatDocView) chatDocView.style.display = "none";
        if (editorEl) {
          editorEl.style.display = "block";
          if (editor) {
            const empty = monaco.editor.createModel("// Abre un archivo desde el explorador (Ctrl+P) o inicia un chat (Ctrl+L)", "plaintext");
            editor.setModel(empty);
          }
        }
      }
    } else {
      renderTabs();
    }
    if (typeof renderChatSidebar === "function") renderChatSidebar();
  }

  function closeActiveTab() {
    if (activeTabType === "chat") {
      closeTab("chat:" + activeChatThreadId);
    } else if (activePath) {
      closeTab(activePath);
    }
  }

  // Save File (Ctrl+S)
  async function save() {
    if (!editor || !activePath) return;
    const content = editor.getValue();
    const tab = openTabs.find((t) => t.path === activePath);
    if (tab) {
      tab.content = content;
      tab.savedContent = content;
      tab.isDirty = false;
      renderTabs();
    }
    await fetch("/api/file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: activePath, content }),
    });
  }

  // Reload buffer after Accept of an edit (Issue #9 & #13)
  async function reloadBufferIfOpen(p) {
    const tab = openTabs.find((t) => t.path === p);
    if (!tab) return;
    try {
      const data = await (await fetch("/api/file?path=" + encodeURIComponent(p))).json();
      const updated = data.content ?? "";
      tab.content = updated;
      tab.savedContent = updated;
      tab.isDirty = false;
      if (tab.model) {
        tab.model.setValue(updated);
      }
      renderTabs();
    } catch {
      // ignore
    }
  }

  // LSP Diagnostics (Issue #11)
  function triggerLspDiagnostics(filepath, content, language, model) {
    clearTimeout(lspTimeout);
    lspTimeout = setTimeout(async () => {
      try {
        const res = await fetch("/api/lsp/diagnostics", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: filepath, content, language }),
        });
        const data = await res.json();
        const markers = (data.diagnostics || []).map((d) => ({
          startLineNumber: d.line || 1,
          startColumn: d.column || 1,
          endLineNumber: d.endLine || d.line || 1,
          endColumn: d.endColumn || (d.column ? d.column + 20 : 100),
          message: d.message,
          severity: d.severity === "warning" ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
        }));
        monaco.editor.setModelMarkers(model, "lsp", markers);
      } catch {
        // ignore
      }
    }, 400);
  }

  // Workspace Search (Issue #9)
  async function performWorkspaceSearch() {
    const q = searchInput.value.trim();
    if (!q) {
      searchResults.innerHTML = '<div style="color: var(--muted); padding: 8px;">Escribe un término y pulsa Enter</div>';
      return;
    }
    searchResults.innerHTML = '<div style="color: var(--muted); padding: 8px;">Buscando…</div>';
    const caseSens = searchCase.checked ? "1" : "0";
    const res = await (await fetch(`/api/search?q=${encodeURIComponent(q)}&caseSensitive=${caseSens}`)).json();
    const matches = res.matches || [];
    searchResults.innerHTML = "";

    if (matches.length === 0) {
      searchResults.innerHTML = '<div style="color: var(--muted); padding: 8px;">No se encontraron resultados</div>';
      return;
    }

    const countHeader = document.createElement("div");
    countHeader.style.padding = "6px 8px";
    countHeader.style.color = "var(--muted)";
    countHeader.style.fontSize = "11px";
    countHeader.textContent = `${matches.length} coincidencia${matches.length === 1 ? "" : "s"}`;
    searchResults.appendChild(countHeader);

    matches.forEach((m) => {
      const row = document.createElement("div");
      row.className = "search-match-item";
      row.innerHTML = `<span class="search-match-file">${m.path}:${m.line}</span><span class="search-match-line">${escapeHtml(m.preview)}</span>`;
      row.addEventListener("click", async () => {
        await openFile(m.path);
        if (editor) {
          editor.revealLineInCenter(m.line);
          editor.setPosition({ lineNumber: m.line, column: m.col || 1 });
          editor.focus();
        }
      });
      searchResults.appendChild(row);
    });
  }

  function escapeHtml(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Palette & Quick Open Modal (Issue #9)
  function showQuickOpen() {
    paletteMode = "files";
    paletteInput.placeholder = "Buscar archivo por nombre…";
    paletteInput.value = "";
    openPalette();
    renderPaletteList();
  }

  function showCommandPalette() {
    paletteMode = "commands";
    paletteInput.placeholder = "Escribe un comando…";
    paletteInput.value = "";
    openPalette();
    renderPaletteList();
  }

  function openPalette() {
    paletteModal.style.display = "flex";
    paletteInput.focus();
    paletteSelectedIndex = 0;
  }

  function closePalette() {
    paletteModal.style.display = "none";
    if (editor) editor.focus();
  }

  const COMMAND_LIST = [
    { id: "quick-open", label: "Abrir archivo...", hint: "Ctrl+P", run: showQuickOpen },
    { id: "open-folder", label: "Abrir carpeta en el workspace...", hint: "", run: showOpenFolderModal },
    { id: "save-file", label: "Guardar archivo activo", hint: "Ctrl+S", run: save },
    { id: "close-tab", label: "Cerrar pestaña activa", hint: "Ctrl+W", run: closeActiveTab },
    { id: "search-ws", label: "Buscar en el workspace...", hint: "Ctrl+Shift+F", run: () => showSidebarTab("search") },
    { id: "toggle-term", label: "Alternar terminal integrada", hint: "Ctrl+`", run: toggleTerminalPanel },
    { id: "toggle-git", label: "Alternar panel Git", hint: "", run: () => openBottomPanel("git") },
    { id: "open-settings", label: "Ajustes de fh-code...", hint: "Ctrl+,", run: showSettingsModal },
    { id: "reset-settings", label: "Restablecer ajustes a valores de fábrica", hint: "", run: handleResetSettings },
    { id: "new-chat", label: "Nuevo chat fh-ia", hint: "", run: () => { messagesEl.innerHTML = ""; append("system", "Nuevo chat iniciado"); } },
    { id: "select-claude", label: "Usar IA: Claude", hint: "", run: () => { providerEl.value = "claude"; fillModels(); } },
    { id: "select-grok", label: "Usar IA: Grok", hint: "", run: () => { providerEl.value = "grok"; fillModels(); } },
    { id: "select-openai", label: "Usar IA: OpenAI-Compatible", hint: "", run: () => { providerEl.value = "openai"; fillModels(); } },
    { id: "select-fcc", label: "Usar IA: FCC (Free Claude Code)", hint: "", run: () => { providerEl.value = "fcc"; fillModels(); } },
    { id: "refresh-tree", label: "Recargar árbol de archivos", hint: "", run: () => loadTree(".", treeEl) },
  ];

  function renderPaletteList() {
    const q = paletteInput.value.toLowerCase().trim();
    paletteList.innerHTML = "";

    if (paletteMode === "files") {
      paletteItems = allWorkspaceFiles
        .filter((f) => !q || f.toLowerCase().includes(q))
        .slice(0, 50)
        .map((f) => ({
          label: f.split("/").pop(),
          hint: f,
          run: () => openFile(f),
        }));
    } else {
      paletteItems = COMMAND_LIST.filter((c) => !q || c.label.toLowerCase().includes(q) || c.id.includes(q));
    }

    if (paletteItems.length === 0) {
      paletteList.innerHTML = '<div style="padding: 10px 14px; color: var(--muted); font-size: 13px;">No hay resultados</div>';
      return;
    }

    if (paletteSelectedIndex >= paletteItems.length) paletteSelectedIndex = 0;

    paletteItems.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "palette-item" + (idx === paletteSelectedIndex ? " selected" : "");
      row.innerHTML = `<span>${escapeHtml(item.label)}</span><span class="palette-item-hint">${escapeHtml(item.hint || "")}</span>`;
      row.addEventListener("click", () => {
        closePalette();
        item.run();
      });
      paletteList.appendChild(row);
    });

    const selectedEl = paletteList.children[paletteSelectedIndex];
    if (selectedEl && selectedEl.scrollIntoView) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }

  // Open Folder (Issue #9)
  async function switchWorkspace(target) {
    try {
      const res = await fetch("/api/workspace/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: target }),
      });
      const data = await res.json();
      if (res.ok) {
        folderModal.style.display = "none";
        openTabs.length = 0;
        activePath = "";
        renderTabs();
        await loadMeta();
        if (editor) {
          const empty = monaco.editor.createModel("// Carpeta abierta: " + data.workspace, "plaintext");
          editor.setModel(empty);
        }
      } else {
        alert("Error al abrir carpeta: " + (data.error || "Ruta inválida"));
      }
    } catch (err) {
      alert("Error: " + err.message);
    }
  }

  async function showOpenFolderModal() {
    // 1. Electron Native Folder Picker Dialog
    if (window.electronAPI && typeof window.electronAPI.openFolderDialog === "function") {
      try {
        const chosen = await window.electronAPI.openFolderDialog();
        if (chosen) {
          await switchWorkspace(chosen);
          return;
        } else {
          // User canceled native picker
          return;
        }
      } catch (err) {
        console.warn("Electron dialog failed:", err);
      }
    }

    // 2. System Native Picker Dialog via server (zenity on Linux, osascript on Mac, powershell on Windows)
    try {
      const res = await (await fetch("/api/workspace/choose-dialog", { method: "POST" })).json();
      if (res.ok && res.workspace) {
        folderModal.style.display = "none";
        openTabs.length = 0;
        activePath = "";
        renderTabs();
        await loadMeta();
        if (editor) {
          const empty = monaco.editor.createModel("// Carpeta abierta: " + res.workspace, "plaintext");
          editor.setModel(empty);
        }
        return;
      }
    } catch {
      // ignore
    }

    // 3. Fallback: Show manual input modal if native dialog was not available
    folderModal.style.display = "flex";
    folderInput.value = "";
    folderInput.focus();
  }

  async function confirmOpenFolder() {
    const target = folderInput.value.trim();
    if (!target) return;
    await switchWorkspace(target);
  }

  // Terminal Panel (Issue #10)
  function toggleTerminalPanel() {
    if (bottomPanel.style.display === "none") {
      openBottomPanel("terminal");
    } else if (panelTerminal.style.display !== "none") {
      bottomPanel.style.display = "none";
    } else {
      openBottomPanel("terminal");
    }
  }

  function openBottomPanel(tab = "terminal") {
    bottomPanel.style.display = "flex";
    if (tab === "terminal") {
      ptabTerminal.classList.add("active");
      ptabGit.classList.remove("active");
      panelTerminal.style.display = "flex";
      panelGit.style.display = "none";
      termInput.focus();
      initTerminalStream();
    } else {
      ptabGit.classList.add("active");
      ptabTerminal.classList.remove("active");
      panelGit.style.display = "flex";
      panelTerminal.style.display = "none";
      loadGitStatus();
    }
    if (editor) editor.layout();
  }

  function initTerminalStream() {
    if (termEventSource) return;
    fetch("/api/terminal/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "default" }),
    }).then((r) => r.json()).then((s) => {
      if (s.history) {
        termOutput.textContent = s.history;
        termOutput.scrollTop = termOutput.scrollHeight;
      }
    });

    termEventSource = new EventSource("/api/terminal/stream?id=default");
    termEventSource.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.output) {
          termOutput.textContent += msg.output;
          termOutput.scrollTop = termOutput.scrollHeight;
        }
      } catch {
        // ignore
      }
    };
  }

  async function sendTerminalCommand() {
    const cmd = termInput.value;
    if (!cmd.trim()) return;
    termHistory.push(cmd);
    termHistoryIndex = termHistory.length;
    termInput.value = "";

    await fetch("/api/terminal/input", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "default", input: cmd + "\n" }),
    });
  }

  // Git Panel (Issue #10)
  async function loadGitStatus() {
    try {
      const res = await (await fetch("/api/git/status")).json();
      gitBranch.textContent = "⎇ " + (res.branch || "HEAD");
      gitFileLists.innerHTML = "";

      if (!res.isRepo) {
        gitFileLists.innerHTML = '<div style="color: var(--muted); padding: 8px;">El workspace actual no es un repositorio Git</div>';
        return;
      }

      // Staged
      if (res.staged && res.staged.length > 0) {
        const title = document.createElement("div");
        title.className = "git-section-title";
        title.textContent = `Cambios preparados (Staged) — ${res.staged.length}`;
        gitFileLists.appendChild(title);

        res.staged.forEach((item) => {
          const row = makeGitFileRow(item.file, item.status, "unstage", true);
          gitFileLists.appendChild(row);
        });
      }

      // Unstaged Changes
      if (res.unstaged && res.unstaged.length > 0) {
        const title = document.createElement("div");
        title.className = "git-section-title";
        title.textContent = `Cambios no preparados — ${res.unstaged.length}`;
        gitFileLists.appendChild(title);

        res.unstaged.forEach((item) => {
          const row = makeGitFileRow(item.file, item.status, "stage", false);
          gitFileLists.appendChild(row);
        });
      }

      // Untracked
      if (res.untracked && res.untracked.length > 0) {
        const title = document.createElement("div");
        title.className = "git-section-title";
        title.textContent = `Archivos sin seguimiento — ${res.untracked.length}`;
        gitFileLists.appendChild(title);

        res.untracked.forEach((item) => {
          const row = makeGitFileRow(item.file, "U", "stage", false);
          gitFileLists.appendChild(row);
        });
      }

      if (!res.staged.length && !res.unstaged.length && !res.untracked.length) {
        gitFileLists.innerHTML = '<div style="color: var(--muted); padding: 8px;">El árbol de trabajo está limpio</div>';
      }
    } catch (err) {
      gitFileLists.innerHTML = `<div style="color: var(--danger); padding: 8px;">Error: ${err.message}</div>`;
    }
  }

  function makeGitFileRow(file, status, op, staged) {
    const row = document.createElement("div");
    row.className = "git-file-row";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.innerHTML = `<span class="git-file-name">${escapeHtml(file)}</span><span class="git-status-badge ${status}">${status}</span>`;
    left.addEventListener("click", () => showGitDiff(file, staged));

    const ops = document.createElement("div");
    ops.className = "git-file-ops";

    if (op === "stage") {
      const addBtn = document.createElement("button");
      addBtn.textContent = "+";
      addBtn.title = "Stage file";
      addBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await fetch("/api/git/stage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: file }),
        });
        loadGitStatus();
      });
      ops.appendChild(addBtn);

      const discardBtn = document.createElement("button");
      discardBtn.textContent = "↺";
      discardBtn.title = "Descartar cambios";
      discardBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (confirm(`¿Descartar cambios en ${file}?`)) {
          await fetch("/api/git/discard", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path: file }),
          });
          loadGitStatus();
          reloadBufferIfOpen(file);
        }
      });
      ops.appendChild(discardBtn);
    } else {
      const minusBtn = document.createElement("button");
      minusBtn.textContent = "−";
      minusBtn.title = "Unstage file";
      minusBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await fetch("/api/git/unstage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: file }),
        });
        loadGitStatus();
      });
      ops.appendChild(minusBtn);
    }

    row.appendChild(left);
    row.appendChild(ops);
    return row;
  }

  async function showGitDiff(file, staged) {
    try {
      const res = await (await fetch(`/api/git/diff?path=${encodeURIComponent(file)}&staged=${staged ? "1" : "0"}`)).json();
      if (!res.diff) {
        alert("Sin diff disponible para este archivo");
        return;
      }
      openDiffView(file, res.diff);
    } catch (err) {
      alert("Error al cargar diff: " + err.message);
    }
  }

  function openDiffView(file, diffText) {
    isDiffMode = true;
    const editorDiv = document.getElementById("editor");
    const diffDiv = document.getElementById("diff-editor");
    editorDiv.style.display = "none";
    diffDiv.style.display = "block";

    if (!diffEditor) {
      diffEditor = monaco.editor.create(diffDiv, {
        value: diffText,
        language: "diff",
        theme: "vs-dark",
        readOnly: true,
        automaticLayout: true,
        fontSize: 14,
      });
    } else {
      diffEditor.setValue(diffText);
    }
    diffEditor.layout();
  }

  function closeDiffView() {
    isDiffMode = false;
    const editorDiv = document.getElementById("editor");
    const diffDiv = document.getElementById("diff-editor");
    diffDiv.style.display = "none";
    editorDiv.style.display = "block";
    if (editor) editor.layout();
  }

  async function commitGit() {
    const msg = gitMessage.value.trim();
    if (!msg) {
      alert("Por favor escribe un mensaje de commit");
      return;
    }
    try {
      const res = await fetch("/api/git/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      if (res.ok) {
        gitMessage.value = "";
        loadGitStatus();
      } else {
        alert("Error al hacer commit: " + (data.error || ""));
      }
    } catch (err) {
      alert("Error: " + err.message);
    }
  }

  // Settings Modal (Issue #13)
  function applySettingsToUi(settings) {
    const theme = settings["fhIa.ui.theme"] || "auto";
    if (theme === "light") {
      document.body.setAttribute("data-theme", "light");
      if (editor) editor.updateOptions({ theme: "vs" });
    } else {
      document.body.removeAttribute("data-theme");
      if (editor) editor.updateOptions({ theme: "vs-dark" });
    }

    const fontSize = Number(settings["fhIa.ui.fontSize"] || 15);
    if (editor) editor.updateOptions({ fontSize });
  }

  async function showSettingsModal() {
    const res = await (await fetch("/api/settings")).json();
    document.getElementById("set-theme").value = res["fhIa.ui.theme"] || "auto";
    document.getElementById("set-font-size").value = res["fhIa.ui.fontSize"] || 15;
    document.getElementById("set-auth-mode").value = res["fhIa.authMode"] || "auto";
    document.getElementById("set-claude-key").value = res["fhIa.claude.apiKey"] || "";
    document.getElementById("set-claude-model").value = res["fhIa.claude.model"] || "claude-sonnet-4-20250514";
    document.getElementById("set-grok-key").value = res["fhIa.grok.apiKey"] || "";
    document.getElementById("set-grok-model").value = res["fhIa.grok.model"] || "grok-4";
    document.getElementById("set-openai-key").value = res["fhIa.openai.apiKey"] || "";
    document.getElementById("set-openai-base").value = res["fhIa.openai.baseUrl"] || "https://api.openai.com/v1";
    document.getElementById("set-openai-model").value = res["fhIa.openai.model"] || "gpt-4o";
    document.getElementById("set-fcc-base").value = res["fhIa.fcc.baseUrl"] || "http://127.0.0.1:8082";
    document.getElementById("set-failover-enabled").checked = res["fhIa.failover.enabled"] !== false;
    document.getElementById("set-failover-order").value = res["fhIa.failover.order"] || "grok,claude,openai";
    settingsModal.style.display = "flex";
  }

  async function saveSettingsFromModal() {
    const payload = {
      "fhIa.ui.theme": document.getElementById("set-theme").value,
      "fhIa.ui.fontSize": Number(document.getElementById("set-font-size").value) || 15,
      "fhIa.authMode": document.getElementById("set-auth-mode").value,
      "fhIa.claude.apiKey": document.getElementById("set-claude-key").value,
      "fhIa.claude.model": document.getElementById("set-claude-model").value,
      "fhIa.grok.apiKey": document.getElementById("set-grok-key").value,
      "fhIa.grok.model": document.getElementById("set-grok-model").value,
      "fhIa.openai.apiKey": document.getElementById("set-openai-key").value,
      "fhIa.openai.baseUrl": document.getElementById("set-openai-base").value,
      "fhIa.openai.model": document.getElementById("set-openai-model").value,
      "fhIa.fcc.baseUrl": document.getElementById("set-fcc-base").value,
      "fhIa.failover.enabled": document.getElementById("set-failover-enabled").checked,
      "fhIa.failover.order": document.getElementById("set-failover-order").value,
    };

    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      applySettingsToUi(data.settings);
      settingsModal.style.display = "none";
    } else {
      alert("Error al guardar ajustes");
    }
  }

  async function handleResetSettings() {
    if (!confirm("¿Restablecer todos los ajustes de fh-code a sus valores por defecto?")) return;
    const res = await fetch("/api/settings/reset", { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      applySettingsToUi(data.settings);
      settingsModal.style.display = "none";
      alert("Ajustes restablecidos correctamente.");
    }
  }

  // Sidebar Tab Switcher
  function showSidebarTab(tab) {
    if (tab === "files") {
      actFiles.classList.add("active");
      actSearch.classList.remove("active");
      sidebarTitle.textContent = "Explorador";
      treeContainer.style.display = "block";
      searchContainer.style.display = "none";
    } else if (tab === "search") {
      actSearch.classList.add("active");
      actFiles.classList.remove("active");
      sidebarTitle.textContent = "Buscar en workspace";
      treeContainer.style.display = "none";
      searchContainer.style.display = "flex";
      searchInput.focus();
    }
  }

  // Chat & Multi-Thread Management (Documents + Historial Panel)
  const btnNewChat = document.getElementById("btn-new-chat");
  const agentThinkingPill = document.getElementById("agent-thinking-pill");
  const agentStatusLabel = document.getElementById("agent-status-label");

  let chatThreads = [];

  function loadChatThreads() {
    try {
      const raw = localStorage.getItem("fh_chat_threads");
      if (raw) chatThreads = JSON.parse(raw);
    } catch (e) {
      chatThreads = [];
    }
    if (!Array.isArray(chatThreads) || chatThreads.length === 0) {
      const initialThread = {
        id: "thread-" + Date.now(),
        title: "Nuevo chat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
      chatThreads = [initialThread];
      activeChatThreadId = initialThread.id;
      saveChatThreads();
    } else {
      activeChatThreadId = chatThreads[0].id;
    }
    renderChatSidebar();
    openChatTab(activeChatThreadId);
  }

  function saveChatThreads() {
    try {
      localStorage.setItem("fh_chat_threads", JSON.stringify(chatThreads));
    } catch (e) {}
    renderChatSidebar();
  }

  function getActiveThread() {
    return chatThreads.find((t) => t.id === activeChatThreadId) || chatThreads[0];
  }

  function formatRelativeTime(ts) {
    const diffSec = Math.floor((Date.now() - ts) / 1000);
    if (diffSec < 60) return "Ahora";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `Hace ${diffMin}m`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `Hace ${diffHr}h`;
    return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function renderChatSidebar() {
    if (!chatSidebarList) return;
    chatSidebarList.innerHTML = "";

    const query = (chatSearchInput ? chatSearchInput.value : "").trim().toLowerCase();
    const filtered = (chatThreads || []).filter((t) => {
      if (!query) return true;
      if ((t.title || "").toLowerCase().includes(query)) return true;
      return (t.messages || []).some((m) => (m.text || "").toLowerCase().includes(query));
    });

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "chat-sidebar-empty";
      empty.textContent = query ? "No hay resultados para la búsqueda." : "No hay conversaciones previas.";
      chatSidebarList.appendChild(empty);
      return;
    }

    filtered.forEach((thread) => {
      const item = document.createElement("div");
      const isItemActive = (activeTabType === "chat" && activeChatThreadId === thread.id);
      item.className = "chat-history-item" + (isItemActive ? " active" : "");

      const main = document.createElement("div");
      main.className = "chat-item-main";

      const title = document.createElement("span");
      title.className = "chat-item-title";
      title.textContent = thread.title || "Nuevo chat";
      title.title = thread.title;

      const meta = document.createElement("span");
      meta.className = "chat-item-meta";
      meta.textContent = `${thread.messages ? thread.messages.length : 0} msgs · ${formatRelativeTime(thread.updatedAt || thread.createdAt || Date.now())}`;

      main.appendChild(title);
      main.appendChild(meta);
      item.appendChild(main);

      const actions = document.createElement("div");
      actions.className = "chat-item-actions";

      // Edit title button (✏️)
      const editBtn = document.createElement("button");
      editBtn.className = "chat-item-btn";
      editBtn.textContent = "✏️";
      editBtn.title = "Renombrar conversación";
      editBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        renameThread(thread.id);
      });
      actions.appendChild(editBtn);

      // Delete button (🗑)
      const delBtn = document.createElement("button");
      delBtn.className = "chat-item-btn btn-del";
      delBtn.textContent = "🗑";
      delBtn.title = "Eliminar conversación";
      delBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        deleteThread(thread.id);
      });
      actions.appendChild(delBtn);

      item.appendChild(actions);

      item.addEventListener("click", () => {
        openChatTab(thread.id);
      });

      chatSidebarList.appendChild(item);
    });
  }

  function createNewChat() {
    const newThread = {
      id: "thread-" + Date.now(),
      title: "Nuevo chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    chatThreads.unshift(newThread);
    saveChatThreads();
    openChatTab(newThread.id);
  }

  function renameThread(threadId) {
    const thread = chatThreads.find((t) => t.id === threadId);
    if (!thread) return;
    const newName = prompt("Nuevo nombre para esta conversación:", thread.title);
    if (newName && newName.trim()) {
      thread.title = newName.trim();
      const tab = openTabs.find((t) => t.type === "chat" && t.threadId === threadId);
      if (tab) tab.title = thread.title;
      if (activeChatThreadId === threadId && chatDocTitle) {
        chatDocTitle.textContent = thread.title;
      }
      saveChatThreads();
      renderTabs();
      renderChatSidebar();
    }
  }

  function deleteThread(threadId) {
    if (!confirm("¿Deseas eliminar esta conversación de forma permanente?")) return;
    const idx = chatThreads.findIndex((t) => t.id === threadId);
    if (idx === -1) return;
    chatThreads.splice(idx, 1);

    // Close any open tab for this conversation
    const tabIdx = openTabs.findIndex((t) => t.type === "chat" && t.threadId === threadId);
    if (tabIdx !== -1) {
      closeTab(openTabs[tabIdx].id);
    }

    if (chatThreads.length === 0) {
      createNewChat();
    } else {
      if (activeChatThreadId === threadId) {
        activeChatThreadId = chatThreads[0].id;
      }
      saveChatThreads();
      renderChatSidebar();
    }
  }

  if (btnNewChat) btnNewChat.addEventListener("click", createNewChat);

  if (chatSearchInput) {
    chatSearchInput.addEventListener("input", renderChatSidebar);
  }

  if (btnRenameChatDoc) {
    btnRenameChatDoc.addEventListener("click", () => {
      renameThread(activeChatThreadId);
    });
  }

  if (btnDeleteChatDoc) {
    btnDeleteChatDoc.addEventListener("click", () => {
      deleteThread(activeChatThreadId);
    });
  }

  if (chatDocTitle) {
    chatDocTitle.addEventListener("dblclick", () => {
      renameThread(activeChatThreadId);
    });
  }

  function append(role, text) {
    const div = document.createElement("div");
    div.className = "msg " + role;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function renderEditsUI(edits, mode) {
    if (!edits || edits.length === 0) return;
    if (mode === "autonomous") {
      for (const edit of edits) {
        const wrap = append("system", "✓ Aplicado automáticamente en " + edit.path);
        const viewBtn = document.createElement("button");
        viewBtn.textContent = "Abrir archivo";
        viewBtn.style.marginLeft = "8px";
        viewBtn.style.cursor = "pointer";
        viewBtn.addEventListener("click", () => openFile(edit.path));
        wrap.appendChild(viewBtn);
      }
    } else {
      edits.forEach((edit) => {
        const wrap = append("system", "Edición propuesta: " + edit.path);
        const diffBtn = document.createElement("button");
        diffBtn.textContent = "Ver Diff";
        diffBtn.style.marginLeft = "8px";
        diffBtn.style.cursor = "pointer";
        diffBtn.addEventListener("click", () => {
          if (edit.diff && edit.diff.unified) {
            openDiffView(edit.path, edit.diff.unified);
          } else {
            openFile(edit.path);
          }
        });
        wrap.appendChild(diffBtn);

        const ok = document.createElement("button");
        ok.textContent = "Accept";
        ok.style.marginLeft = "6px";
        ok.style.cursor = "pointer";
        ok.addEventListener("click", async () => {
          await fetch("/api/edit/accept", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ edit }),
          });
          wrap.textContent = "✓ Aplicado " + edit.path;
          if (activePath !== edit.path) {
            await openFile(edit.path);
          } else {
            await reloadBufferIfOpen(edit.path);
          }
        });
        wrap.appendChild(ok);

        const rejectBtn = document.createElement("button");
        rejectBtn.textContent = "Reject";
        rejectBtn.style.marginLeft = "6px";
        rejectBtn.style.cursor = "pointer";
        rejectBtn.addEventListener("click", () => {
          wrap.textContent = "✕ Rechazado " + edit.path;
        });
        wrap.appendChild(rejectBtn);
      });
    }
  }

  function renderCurrentThreadMessages() {
    messagesEl.innerHTML = "";
    const thread = getActiveThread();
    if (!thread || !thread.messages || thread.messages.length === 0) {
      append("system", "✦ Nuevo chat iniciado. ¿En qué te puedo ayudar hoy?");
      return;
    }
    for (const m of thread.messages) {
      if (m.role === "user") {
        append("user", m.text);
      } else if (m.role === "assistant") {
        append("assistant", m.text);
        if (m.edits && m.edits.length > 0) {
          renderEditsUI(m.edits, m.mode);
        }
      } else if (m.role === "system") {
        append("system", m.text);
      } else if (m.role === "error") {
        append("error", m.text);
      }
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function send() {
    const text = String(inputEl.value || "").trim();
    if (!text || streaming) return;
    inputEl.value = "";

    const thread = getActiveThread();
    if (thread.title === "Nuevo chat" || !thread.title) {
      thread.title = text.length > 32 ? text.slice(0, 32) + "…" : text;
      const tab = openTabs.find((t) => t.type === "chat" && t.threadId === thread.id);
      if (tab) tab.title = thread.title;
      if (chatDocTitle) chatDocTitle.textContent = thread.title;
      renderTabs();
    }
    thread.messages.push({ role: "user", text, timestamp: Date.now() });
    thread.updatedAt = Date.now();
    saveChatThreads();

    append("user", text);

    // Visual feedback: Thinking pill in header & animated thinking card
    if (agentThinkingPill) {
      agentThinkingPill.style.display = "inline-flex";
      if (agentStatusLabel) agentStatusLabel.textContent = "Pensando…";
    }

    const thinkingNode = document.createElement("div");
    thinkingNode.className = "thinking-card";
    thinkingNode.innerHTML = `
      <div class="thinking-card-header">
        <span>✦ fh-ia está procesando</span>
        <span class="typing-dots"><span></span><span></span><span></span></span>
      </div>
      <div class="thinking-detail">Analizando contexto y código del workspace…</div>
    `;
    messagesEl.appendChild(thinkingNode);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    const node = append("assistant", "");
    node.style.display = "none";
    streaming = true;

    let assistantText = "";
    let finalEdits = [];
    let finalMode = modeEl.value;

    let selection = undefined;
    if (editor && activePath) {
      const sel = editor.getSelection();
      if (sel && !sel.isEmpty()) {
        selection = {
          text: editor.getModel().getValueInRange(sel),
          startLine: sel.startLineNumber,
          endLine: sel.endLineNumber,
        };
      }
    }
    const activeContent = (editor && activePath) ? editor.getValue() : undefined;
    const openFileList = openTabs.filter((t) => t.type !== "chat" && t.path).map((t) => t.path);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: thread.id,
          text,
          provider: providerEl.value,
          model: modelEl.value,
          mode: modeEl.value,
          activePath,
          activeContent,
          selection,
          openFiles: openFileList,
        }),
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const msg = JSON.parse(line.slice(6));
          if (msg.type === "delta") {
            if (thinkingNode.parentNode) thinkingNode.remove();
            node.style.display = "";
            node.textContent += msg.text || "";
            assistantText += msg.text || "";
            if (agentStatusLabel) agentStatusLabel.textContent = "Generando respuesta…";
          }
          else if (msg.type === "status") {
            if (agentStatusLabel) agentStatusLabel.textContent = msg.text || "Trabajando…";
            append("system", msg.text || "");
          }
          else if (msg.type === "error") {
            if (thinkingNode.parentNode) thinkingNode.remove();
            append("error", msg.message || "Error");
            thread.messages.push({ role: "error", text: msg.message || "Error", timestamp: Date.now() });
            saveChatThreads();
          }
          else if (msg.type === "done") {
            if (thinkingNode.parentNode) thinkingNode.remove();
            node.style.display = "";
            if (msg.text) {
              node.textContent = msg.text;
              assistantText = msg.text;
            }
            finalEdits = msg.edits || [];
            finalMode = msg.mode || modeEl.value;

            // Save assistant message to persistent thread
            thread.messages.push({
              role: "assistant",
              text: assistantText,
              edits: finalEdits,
              mode: finalMode,
              timestamp: Date.now(),
            });
            thread.updatedAt = Date.now();
            saveChatThreads();

            // Render edit action buttons and handle autonomous reloading
            renderEditsUI(finalEdits, finalMode);

            if (finalMode === "autonomous" && finalEdits.length > 0) {
              for (const edit of finalEdits) {
                await reloadBufferIfOpen(edit.path);
              }
            }
          }
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      }
    } catch (err) {
      append("error", "Error de conexión: " + (err.message || err));
      thread.messages.push({ role: "error", text: "Error de conexión: " + (err.message || err), timestamp: Date.now() });
      saveChatThreads();
    } finally {
      if (thinkingNode.parentNode) thinkingNode.remove();
      node.style.display = "";
      if (agentThinkingPill) agentThinkingPill.style.display = "none";
      streaming = false;
    }
  }

  // Event Listeners
  providerEl.addEventListener("change", fillModels);
  document.getElementById("send").addEventListener("click", send);
  inputEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      send();
    }
  });

  // Global Shortcuts
  window.addEventListener("keydown", (ev) => {
    // Ctrl+S / Cmd+S: Save
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "s") {
      ev.preventDefault();
      save();
      return;
    }
    // Ctrl+L / Cmd+L: Focus chat input
    if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && (ev.key === "l" || ev.key === "L")) {
      ev.preventDefault();
      inputEl.focus();
      return;
    }
    // Ctrl+P / Cmd+P: Quick Open Files
    if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && (ev.key === "p" || ev.key === "P")) {
      ev.preventDefault();
      showQuickOpen();
      return;
    }
    // Ctrl+Shift+P / Cmd+Shift+P: Command Palette
    if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && (ev.key === "P" || ev.key === "p")) {
      ev.preventDefault();
      showCommandPalette();
      return;
    }
    // Ctrl+Shift+F: Search in Workspace
    if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && (ev.key === "F" || ev.key === "f")) {
      ev.preventDefault();
      showSidebarTab("search");
      return;
    }
    // Ctrl+W: Close active tab
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === "w" || ev.key === "W")) {
      ev.preventDefault();
      closeActiveTab();
      return;
    }
    // Ctrl+`: Toggle Terminal
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "`") {
      ev.preventDefault();
      toggleTerminalPanel();
      return;
    }
    // Ctrl+,: Open Settings
    if ((ev.ctrlKey || ev.metaKey) && ev.key === ",") {
      ev.preventDefault();
      showSettingsModal();
      return;
    }
    // Escape: Close modals
    if (ev.key === "Escape") {
      if (paletteModal.style.display !== "none") closePalette();
      if (folderModal.style.display !== "none") folderModal.style.display = "none";
      if (settingsModal.style.display !== "none") settingsModal.style.display = "none";
      if (isDiffMode) closeDiffView();
    }
  });

  // Titlebar buttons
  btnOpenFolder.addEventListener("click", showOpenFolderModal);
  btnQuickOpen.addEventListener("click", showQuickOpen);
  btnCmdPalette.addEventListener("click", showCommandPalette);
  btnToggleTerminal.addEventListener("click", toggleTerminalPanel);
  btnOpenSettings.addEventListener("click", showSettingsModal);
  btnRefreshTree.addEventListener("click", () => { loadTree(".", treeEl); scanAllFiles(); });

  // Activity Bar
  actFiles.addEventListener("click", () => showSidebarTab("files"));
  actSearch.addEventListener("click", () => showSidebarTab("search"));
  actGit.addEventListener("click", () => openBottomPanel("git"));
  actTerminal.addEventListener("click", () => openBottomPanel("terminal"));
  actSettings.addEventListener("click", showSettingsModal);
  if (actChat) actChat.addEventListener("click", () => inputEl.focus());

  // Search input
  searchInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") performWorkspaceSearch();
  });
  searchCase.addEventListener("change", performWorkspaceSearch);

  // Bottom panel
  ptabTerminal.addEventListener("click", () => openBottomPanel("terminal"));
  ptabGit.addEventListener("click", () => openBottomPanel("git"));
  btnClosePanel.addEventListener("click", () => {
    bottomPanel.style.display = "none";
    if (editor) editor.layout();
  });
  btnClearTerm.addEventListener("click", () => { termOutput.textContent = ""; });
  termInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      sendTerminalCommand();
    } else if (ev.key === "ArrowUp") {
      if (termHistory.length && termHistoryIndex > 0) {
        termHistoryIndex--;
        termInput.value = termHistory[termHistoryIndex] || "";
      }
    } else if (ev.key === "ArrowDown") {
      if (termHistory.length && termHistoryIndex < termHistory.length - 1) {
        termHistoryIndex++;
        termInput.value = termHistory[termHistoryIndex] || "";
      } else {
        termHistoryIndex = termHistory.length;
        termInput.value = "";
      }
    }
  });

  // Git controls
  btnGitRefresh.addEventListener("click", loadGitStatus);
  btnGitStageAll.addEventListener("click", async () => {
    await fetch("/api/git/stage-all", { method: "POST" });
    loadGitStatus();
  });
  btnGitCommit.addEventListener("click", commitGit);
  gitMessage.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      commitGit();
    }
  });

  // Palette Navigation
  paletteInput.addEventListener("input", renderPaletteList);
  paletteInput.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (paletteItems.length) {
        paletteSelectedIndex = (paletteSelectedIndex + 1) % paletteItems.length;
        renderPaletteList();
      }
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      if (paletteItems.length) {
        paletteSelectedIndex = (paletteSelectedIndex - 1 + paletteItems.length) % paletteItems.length;
        renderPaletteList();
      }
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      if (paletteItems[paletteSelectedIndex]) {
        const item = paletteItems[paletteSelectedIndex];
        closePalette();
        item.run();
      }
    }
  });
  paletteModal.addEventListener("click", (ev) => {
    if (ev.target === paletteModal) closePalette();
  });

  // Folder modal
  btnFolderCancel.addEventListener("click", () => { folderModal.style.display = "none"; });
  btnFolderConfirm.addEventListener("click", confirmOpenFolder);
  const btnFolderNative = document.getElementById("btn-folder-native");
  if (btnFolderNative) {
    btnFolderNative.addEventListener("click", () => {
      folderModal.style.display = "none";
      showOpenFolderModal();
    });
  }
  folderInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") confirmOpenFolder();
  });
  folderModal.addEventListener("click", (ev) => {
    if (ev.target === folderModal) folderModal.style.display = "none";
  });

  // Settings modal
  btnSettingsClose.addEventListener("click", () => { settingsModal.style.display = "none"; });
  btnSettingsCancel.addEventListener("click", () => { settingsModal.style.display = "none"; });
  btnSettingsSave.addEventListener("click", saveSettingsFromModal);
  btnSettingsReset.addEventListener("click", handleResetSettings);
  settingsModal.addEventListener("click", (ev) => {
    if (ev.target === settingsModal) settingsModal.style.display = "none";
  });

  // Initialize Monaco Offline with TypeScript / LSP (Issue #11 & #12)
  require.config({ paths: { vs: "/static/vendor/monaco/min/vs" } });
  require(["vs/editor/editor.main"], () => {
    // TypeScript & JavaScript Compiler and Language Services (IntelliSense)
    if (monaco.languages && monaco.languages.typescript) {
      monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ES2022,
        allowNonTsExtensions: true,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        module: monaco.languages.typescript.ModuleKind.CommonJS,
        noEmit: true,
        allowJs: true,
        checkJs: true,
      });
      monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ES2022,
        allowNonTsExtensions: true,
        allowJs: true,
        checkJs: true,
      });
      monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
      });
      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
      });
    }

    editor = monaco.editor.create(document.getElementById("editor"), {
      value: "// Abre un archivo desde el explorador (Ctrl+P)\n",
      language: "typescript",
      theme: "vs-dark",
      automaticLayout: true,
      fontSize: 15,
      minimap: { enabled: true },
      smoothScrolling: true,
      suggestOnTriggerCharacters: true,
      parameterHints: { enabled: true },
      quickSuggestions: { other: true, comments: true, strings: true },
      tabCompletion: "on",
    });

    loadMeta();
    loadChatThreads();
  });
})();
