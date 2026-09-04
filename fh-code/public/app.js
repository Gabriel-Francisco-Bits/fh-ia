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

  const SVGS = {
    chevronRight: `<svg class="tree-chevron-svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>`,
    chevronDown: `<svg class="tree-chevron-svg down" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>`,
    folderClosed: `<svg class="tree-folder-icon" viewBox="0 0 16 16" width="16" height="16" fill="#c5c5c5"><path d="M14.5 4H7.88a1.5 1.5 0 0 1-1.06-.44L5.38 2.12A1.5 1.5 0 0 0 4.32 1.68H1.5A1.5 1.5 0 0 0 0 3.18v9.64A1.5 1.5 0 0 0 1.5 14.32h13a1.5 1.5 0 0 0 1.5-1.5V5.5A1.5 1.5 0 0 0 14.5 4z"/></svg>`,
    folderOpen: `<svg class="tree-folder-icon" viewBox="0 0 16 16" width="16" height="16" fill="#e5c07b"><path d="M1.5 2A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H7.88L6.44 3.06A1.5 1.5 0 0 0 5.38 2.5H1.5zM1 5h14v1.5l-1.8 6H2.8L1 6.5V5z"/></svg>`,
    fileTs: `<svg class="file-icon-svg" viewBox="0 0 16 16" width="16" height="16"><rect width="16" height="16" rx="3" fill="#3178c6"/><text x="3" y="11.5" font-family="system-ui, -apple-system, sans-serif" font-size="8.5" font-weight="900" fill="#ffffff" letter-spacing="-0.5">TS</text></svg>`,
    fileJs: `<svg class="file-icon-svg" viewBox="0 0 16 16" width="16" height="16"><rect width="16" height="16" rx="3" fill="#f7df1e"/><text x="3.5" y="11.5" font-family="system-ui, -apple-system, sans-serif" font-size="8.5" font-weight="900" fill="#111111" letter-spacing="-0.5">JS</text></svg>`,
    fileJson: `<svg class="file-icon-svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#eab308" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3c-.9 0-1.5.6-1.5 1.5v2c0 .8-.8 1.5-1.5 1.5.7 0 1.5.7 1.5 1.5v2c0 .9.6 1.5 1.5 1.5M11 3c.9 0 1.5.6 1.5 1.5v2c0 .8.8 1.5 1.5 1.5-.7 0-1.5.7-1.5 1.5v2c0 .9-.6 1.5-1.5 1.5"/></svg>`,
    fileMd: `<svg class="file-icon-svg" viewBox="0 0 16 16" width="16" height="16" fill="#38bdf8"><path d="M1 3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3zm2 2v6h1.6V7.7L6 9.3l1.4-1.6V11H9V5H7.4L6 6.8 4.6 5H3zm8 0v3.6h-1.2L11.5 11l1.7-2.4H12V5h-1z"/></svg>`,
    fileHtml: `<svg class="file-icon-svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#f97316" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 5L1.5 8l3 3M11.5 5l3 3-3 3M9.5 3.5l-3 9"/></svg>`,
    fileCss: `<svg class="file-icon-svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#38bdf8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h10M3 10h10M6.5 3l-1 10M10.5 3l-1 10"/></svg>`,
    filePy: `<svg class="file-icon-svg" viewBox="0 0 16 16" width="16" height="16"><path fill="#38bdf8" d="M7.9 1a3.9 3.9 0 0 0-3.9 3.9v1.6h4.7v.8H3.2A2.2 2.2 0 0 0 1 9.5a2.2 2.2 0 0 0 2.2 2.2h.9V10a2.2 2.2 0 0 1 2.2-2.2h4.7a1.6 1.6 0 0 0 1.6-1.6V3.9A2.9 2.9 0 0 0 7.9 1zm-1.2 1.2a.6.6 0 1 1 0 1.2.6.6 0 0 1 0-1.2z"/><path fill="#facc15" d="M8.1 15a3.9 3.9 0 0 0 3.9-3.9V9.5H7.3v-.8h5.5A2.2 2.2 0 0 0 15 6.5a2.2 2.2 0 0 0-2.2-2.2h-.9V6a2.2 2.2 0 0 1-2.2 2.2H5.1A1.6 1.6 0 0 0 3.5 9.8v2.3A2.9 2.9 0 0 0 8.1 15zm1.2-1.2a.6.6 0 1 1 0-1.2.6.6 0 0 1 0 1.2z"/></svg>`,
    fileGit: `<svg class="file-icon-svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#f34f29" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="4" r="2"/><circle cx="4" cy="12" r="2"/><circle cx="12" cy="6" r="2"/><path d="M4 6v4M6 12h2a3 3 0 0 0 3-3V7"/></svg>`,
    fileSh: `<svg class="file-icon-svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#4ade80" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5l3.5 3.5L3 11.5M8 12h5"/></svg>`,
    fileImg: `<svg class="file-icon-svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#c084fc" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="12" rx="2"/><circle cx="5.5" cy="5.5" r="1.2" fill="#c084fc"/><path d="M14 10l-4-4-6 6"/></svg>`,
    fileYml: `<svg class="file-icon-svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#f87171" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2h7l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M10 2v3h3M5 8h6M5 11h4"/></svg>`,
    fileDefault: `<svg class="file-icon-svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#94a3b8" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2h7l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M10 2v3h3"/></svg>`,
    sparkle: `<svg class="cursor-sparkle" viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 0C8 4.418 4.418 8 0 8C4.418 8 8 11.582 8 16C8 11.582 11.582 8 16 8C11.582 8 8 4.418 8 0Z"/></svg>`,
    close: `<svg class="tab-close-svg" viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>`,
    edit: `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2l3 3L5 14H2v-3L11 2z"/></svg>`,
    trash: `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h10M5 4V2h6v2M6 7v5M10 7v5M4 4l.8 9.5a1 1 0 0 0 1 .5h4.4a1 1 0 0 0 1-.5L12 4"/></svg>`,
    eye: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M1.5 8s2.5-4.5 6.5-4.5 6.5 4.5 6.5 4.5-2.5 4.5-6.5 4.5-6.5-4.5-6.5-4.5z"/></svg>`,
    eyeOff: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2l12 12M6.5 6.6A2.5 2.5 0 0 0 9.4 9.5M4 4.5C2.7 5.5 1.8 7 1.5 8c0 0 2.5 4.5 6.5 4.5 1.5 0 2.8-.5 4-1.3M7 3.5c.3 0 .7 0 1 .1 4 0 6.5 4.4 6.5 4.4a11.8 11.8 0 0 1-2.2 2.7"/></svg>`,
  };

  function getFileIconHtml(name, isDir, isOpen) {
    if (isDir) {
      if (name === ".git" || name === ".github") return SVGS.fileGit;
      return isOpen ? SVGS.folderOpen : SVGS.folderClosed;
    }
    const ext = (name.split(".").pop() || "").toLowerCase();
    switch (ext) {
      case "ts":
      case "tsx":
        return SVGS.fileTs;
      case "js":
      case "jsx":
      case "mjs":
      case "cjs":
        return SVGS.fileJs;
      case "json":
        return SVGS.fileJson;
      case "md":
        return SVGS.fileMd;
      case "html":
      case "htm":
        return SVGS.fileHtml;
      case "css":
      case "scss":
      case "less":
        return SVGS.fileCss;
      case "py":
        return SVGS.filePy;
      case "git":
      case "gitignore":
      case "gitattributes":
        return SVGS.fileGit;
      case "sh":
      case "bash":
      case "zsh":
        return SVGS.fileSh;
      case "png":
      case "jpg":
      case "jpeg":
      case "svg":
      case "ico":
      case "gif":
      case "webp":
        return SVGS.fileImg;
      case "yml":
      case "yaml":
        return SVGS.fileYml;
      default:
        return SVGS.fileDefault;
    }
  }

  // File Tree
  async function loadTree(dir = ".", into = treeEl) {
    const data = await (await fetch("/api/tree?dir=" + encodeURIComponent(dir))).json();
    into.innerHTML = "";
    for (const ent of data.entries || []) {
      const itemRow = document.createElement("div");
      itemRow.className = "tree-row " + (ent.dir ? "dir-row" : "file-row");
      if (!ent.dir && ent.path === activePath) itemRow.classList.add("active");
      itemRow.setAttribute("data-path", ent.path);

      let chevronHtml = ent.dir
        ? `<span class="tree-chevron">${SVGS.chevronRight}</span>`
        : '<span class="tree-indent-spacer"></span>';

      let iconHtml = `<span class="tree-file-icon">${getFileIconHtml(ent.name, ent.dir, false)}</span>`;

      itemRow.innerHTML = `
        <div class="tree-item-left">
          ${chevronHtml}
          ${iconHtml}
          <span class="tree-name" title="${escapeHtml(ent.path)}">${escapeHtml(ent.name)}</span>
        </div>
      `;

      const nested = document.createElement("div");
      nested.className = "nested";
      nested.style.display = "none";
      let open = false;

      itemRow.querySelector(".tree-item-left").addEventListener("click", async () => {
        if (ent.dir) {
          open = !open;
          const chev = itemRow.querySelector(".tree-chevron");
          if (chev) {
            chev.innerHTML = open ? SVGS.chevronDown : SVGS.chevronRight;
            chev.classList.toggle("open", open);
          }
          const iconEl = itemRow.querySelector(".tree-file-icon");
          if (iconEl) {
            iconEl.innerHTML = getFileIconHtml(ent.name, true, open);
          }
          if (open) {
            nested.style.display = "block";
            await loadTree(ent.path, nested);
          } else {
            nested.style.display = "none";
            nested.innerHTML = "";
          }
        } else {
          document.querySelectorAll(".tree-row.file-row").forEach((r) => r.classList.remove("active"));
          itemRow.classList.add("active");
          openFile(ent.path);
        }
      });

      into.appendChild(itemRow);
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
      icon.className = "tab-icon";
      icon.style.display = "inline-flex";
      icon.style.alignItems = "center";
      icon.style.marginRight = "6px";
      icon.innerHTML = isChat
        ? `<span style="color: var(--accent); display: inline-flex;">${SVGS.sparkle}</span>`
        : getFileIconHtml(t.path || "");
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
      closeBtn.innerHTML = SVGS.close;
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

      // Edit title button
      const editBtn = document.createElement("button");
      editBtn.className = "chat-item-btn";
      editBtn.innerHTML = SVGS.edit;
      editBtn.title = "Renombrar conversación";
      editBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        renameThread(thread.id);
      });
      actions.appendChild(editBtn);

      // Delete button
      const delBtn = document.createElement("button");
      delBtn.className = "chat-item-btn btn-del";
      delBtn.innerHTML = SVGS.trash;
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

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderMarkdown(md) {
    if (!md) return "";

    // 1. Extract and protect code blocks
    const codeBlocks = [];
    let processed = md.replace(/```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g, (match, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push({ lang: (lang || "code").trim(), code: code.replace(/\r?\n$/, "") });
      return `___CODE_BLOCK_${idx}___`;
    });

    // Helper for inline elements: bold, italic, inline-code, links
    function formatInline(text) {
      let t = escapeHtml(text);
      // Inline code `code`
      t = t.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
      // Bold **text**
      t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      // Italic *text*
      t = t.replace(/(^|[^\*])\*([^*]+)\*([^\*]|$)/g, '$1<em>$2</em>$3');
      // Links [text](url)
      t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a class="md-link" href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      return t;
    }

    // 2. Process line by line
    const lines = processed.split(/\r?\n/);
    const out = [];
    let inList = null; // 'ul' or 'ol'
    let listItems = [];

    function closeList() {
      if (!inList) return;
      if (inList === "ul") {
        out.push('<ul class="md-ul">' + listItems.join("") + '</ul>');
      } else if (inList === "ol") {
        out.push('<ol class="md-ol">' + listItems.join("") + '</ol>');
      }
      inList = null;
      listItems = [];
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Check for code block token
      const codeMatch = trimmed.match(/^___CODE_BLOCK_(\d+)___$/);
      if (codeMatch) {
        closeList();
        const block = codeBlocks[parseInt(codeMatch[1], 10)];
        out.push(`
          <div class="code-block-wrap">
            <div class="code-block-header">
              <span class="code-lang-tag">${escapeHtml(block.lang)}</span>
              <button class="code-copy-btn" data-code="${encodeURIComponent(block.code)}">📋 Copiar</button>
            </div>
            <pre class="code-block-pre"><code class="code-block-content">${escapeHtml(block.code)}</code></pre>
          </div>
        `);
        continue;
      }

      // Headings
      if (/^###\s+/.test(trimmed)) {
        closeList();
        out.push(`<h3 class="md-h3">${formatInline(trimmed.replace(/^###\s+/, ""))}</h3>`);
        continue;
      }
      if (/^##\s+/.test(trimmed)) {
        closeList();
        out.push(`<h2 class="md-h2">${formatInline(trimmed.replace(/^##\s+/, ""))}</h2>`);
        continue;
      }
      if (/^#\s+/.test(trimmed)) {
        closeList();
        out.push(`<h1 class="md-h1">${formatInline(trimmed.replace(/^#\s+/, ""))}</h1>`);
        continue;
      }

      // Blockquote
      if (/^>\s+/.test(trimmed)) {
        closeList();
        out.push(`<blockquote class="md-quote">${formatInline(trimmed.replace(/^>\s+/, ""))}</blockquote>`);
        continue;
      }

      // Horizontal rule
      if (/^(\*\*\*|---|___)$/.test(trimmed)) {
        closeList();
        out.push('<hr class="md-hr">');
        continue;
      }

      // Markdown Tables
      if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
        closeList();
        const tableLines = [trimmed];
        while (i + 1 < lines.length && lines[i + 1].trim().startsWith("|") && lines[i + 1].trim().endsWith("|")) {
          i++;
          tableLines.push(lines[i].trim());
        }
        if (tableLines.length >= 2 && /^\|[\s-:]+\|$/.test(tableLines[1].replace(/\|/g, "|").trim())) {
          const headerCells = tableLines[0].slice(1, -1).split("|").map(c => c.trim());
          let tableHtml = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
          headerCells.forEach(h => {
            tableHtml += `<th>${formatInline(h)}</th>`;
          });
          tableHtml += '</tr></thead><tbody>';
          for (let r = 2; r < tableLines.length; r++) {
            const rowCells = tableLines[r].slice(1, -1).split("|").map(c => c.trim());
            tableHtml += '<tr>';
            rowCells.forEach(cell => {
              tableHtml += `<td>${formatInline(cell)}</td>`;
            });
            tableHtml += '</tr>';
          }
          tableHtml += '</tbody></table></div>';
          out.push(tableHtml);
          continue;
        } else {
          for (const tl of tableLines) {
            out.push(`<p class="md-p">${formatInline(tl)}</p>`);
          }
          continue;
        }
      }

      // Task list item (- [ ] or - [x])
      const taskMatch = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/);
      if (taskMatch) {
        if (inList !== "ul") {
          closeList();
          inList = "ul";
        }
        const checked = taskMatch[2].toLowerCase() === "x";
        listItems.push(`<li class="md-li md-task-item"><input type="checkbox" disabled ${checked ? "checked" : ""} /> <span>${formatInline(taskMatch[3])}</span></li>`);
        continue;
      }

      // Unordered list item (- or *)
      const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)$/);
      if (ulMatch) {
        if (inList !== "ul") {
          closeList();
          inList = "ul";
        }
        listItems.push(`<li class="md-li">${formatInline(ulMatch[2])}</li>`);
        continue;
      }

      // Ordered list item (1. 2. etc.)
      const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
      if (olMatch) {
        if (inList !== "ol") {
          closeList();
          inList = "ol";
        }
        const num = olMatch[2];
        const content = olMatch[3];
        // If content has quotes like "¿Qué hay para hacer?", make it actionable on click
        const quoteMatch = content.match(/"([^"]+)"/);
        const actionAttr = quoteMatch ? ` data-action="${escapeHtml(quoteMatch[1])}" title="Click para enviar: ${escapeHtml(quoteMatch[1])}"` : "";
        const actionClass = quoteMatch ? "md-ol-item actionable" : "md-ol-item";
        listItems.push(`
          <li class="${actionClass}"${actionAttr}>
            <span class="ol-num">${num}</span>
            <div class="ol-content">${formatInline(content)}</div>
          </li>
        `);
        continue;
      }

      // Empty line closes active list or adds spacing
      if (trimmed === "") {
        closeList();
        continue;
      }

      // Regular paragraph
      closeList();
      out.push(`<p class="md-p">${formatInline(line)}</p>`);
    }
    closeList();

    return out.join("");
  }

  function appendAssistant(text, meta) {
    const div = document.createElement("div");
    div.className = "msg assistant";

    const header = document.createElement("div");
    header.className = "assistant-msg-header";
    header.innerHTML = `
      <div class="assistant-avatar-badge">
        <img src="/logo.png" alt="FH" class="assistant-avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
        <span class="assistant-avatar-fallback" style="display:none;">FH</span>
        <span class="assistant-name">fh-ia</span>
      </div>
      <div class="assistant-actions">
        <button class="btn-copy-msg" title="Copiar respuesta completa">📋 Copiar</button>
      </div>
    `;

    const body = document.createElement("div");
    body.className = "msg-body";
    body.innerHTML = renderMarkdown(text);

    div.appendChild(header);
    div.appendChild(body);

    if (meta) {
      const metaBar = formatMetaBar(meta);
      if (metaBar) div.appendChild(metaBar);
    }

    bindAssistantInteractions(div, text);

    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function updateAssistantMessage(div, text, isDone, meta) {
    const body = div.querySelector(".msg-body");
    if (body) {
      body.innerHTML = renderMarkdown(text);
    }
    // Remove old meta bar if exists
    const oldMeta = div.querySelector(".msg-meta-bar");
    if (oldMeta) oldMeta.remove();

    if (meta) {
      const metaBar = formatMetaBar(meta);
      if (metaBar) div.appendChild(metaBar);
    }

    if (isDone) {
      bindAssistantInteractions(div, text);
    }
  }

  function bindAssistantInteractions(div, fullText) {
    // Copy entire response button
    const copyBtn = div.querySelector(".btn-copy-msg");
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(fullText || "").then(() => {
          const prev = copyBtn.textContent;
          copyBtn.textContent = "✓ Copiado";
          setTimeout(() => { copyBtn.textContent = prev; }, 2000);
        });
      };
    }

    // Code copy buttons
    div.querySelectorAll(".code-copy-btn").forEach((btn) => {
      btn.onclick = () => {
        const raw = decodeURIComponent(btn.getAttribute("data-code") || "");
        navigator.clipboard.writeText(raw).then(() => {
          btn.textContent = "✓ Copiado";
          setTimeout(() => { btn.textContent = "📋 Copiar"; }, 2000);
        });
      };
    });

    // Actionable numbered items
    div.querySelectorAll(".md-ol-item.actionable").forEach((item) => {
      item.onclick = () => {
        const action = item.getAttribute("data-action");
        if (action && inputEl) {
          inputEl.value = action;
          inputEl.focus();
        }
      };
    });
  }

  function append(role, text) {
    if (role === "assistant") {
      return appendAssistant(text, null);
    }
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

  // Settings Tabs Navigation & Peek Toggles
  document.querySelectorAll(".settings-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".settings-tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tabId = btn.getAttribute("data-tab");
      document.querySelectorAll(".settings-pane").forEach((pane) => {
        pane.style.display = "none";
      });
      const targetPane = document.getElementById("set-pane-" + tabId);
      if (targetPane) targetPane.style.display = "flex";
    });
  });

  document.querySelectorAll(".key-field-wrap").forEach((wrap) => {
    const input = wrap.querySelector("input");
    const toggleBtn = wrap.querySelector(".btn-toggle-peek");
    if (input && toggleBtn) {
      toggleBtn.innerHTML = SVGS.eye;
      toggleBtn.addEventListener("click", () => {
        const isPassword = input.type === "password";
        input.type = isPassword ? "text" : "password";
        toggleBtn.innerHTML = isPassword ? SVGS.eyeOff : SVGS.eye;
      });
    }
  });

  function formatMetaBar(meta) {
    if (!meta) return null;
    const bar = document.createElement("div");
    bar.className = "msg-meta-bar";

    // Duration chip
    if (meta.durationMs != null) {
      const sec = (meta.durationMs / 1000).toFixed(1);
      const chip = document.createElement("span");
      chip.className = "meta-chip time";
      chip.innerHTML = `<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style="margin-right: 4px; display: inline-flex;"><path d="M8.5 1.5l-5 7h4l-1 6 6-8h-4l1-5z"/></svg>${sec}s`;
      chip.title = `Tiempo de respuesta: ${meta.durationMs}ms`;
      bar.appendChild(chip);
    }

    // Token count chip
    if (meta.usage && (meta.usage.totalTokens || meta.usage.completionTokens)) {
      const total = meta.usage.totalTokens || meta.usage.completionTokens;
      const chip = document.createElement("span");
      chip.className = "meta-chip tokens";
      chip.innerHTML = `<svg class="cursor-sparkle" viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style="margin-right: 4px; display: inline-flex;"><path d="M8 0C8 4.418 4.418 8 0 8C4.418 8 8 11.582 8 16C8 11.582 11.582 8 16 8C11.582 8 8 4.418 8 0Z"/></svg>${total} tokens`;
      chip.title = meta.usage.promptTokens ? `Prompt: ${meta.usage.promptTokens} | Salida: ${meta.usage.completionTokens}` : "Tokens calculados";
      bar.appendChild(chip);
    }

    // Rate Limit / Quota chip
    if (meta.rateLimit && meta.rateLimit.usedPercent != null) {
      const chip = document.createElement("span");
      const pct = meta.rateLimit.usedPercent;
      let statusClass = "quota";
      if (pct >= 85) statusClass = "quota danger";
      else if (pct >= 60) statusClass = "quota warning";
      chip.className = `meta-chip ${statusClass}`;
      chip.innerHTML = `<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" style="margin-right: 4px; display: inline-flex;"><path d="M1 14h14v1H1v-1zm2-3h2v2H3v-2zm4-4h2v6H7V7zm4-4h2v10h-2V3z"/></svg>Límite: ${pct}% usado`;
      if (meta.rateLimit.remaining != null && meta.rateLimit.limit != null) {
        chip.title = `Restante: ${meta.rateLimit.remaining} / ${meta.rateLimit.limit} (${meta.rateLimit.kind || "cuota"})`;
      }
      bar.appendChild(chip);
    }

    return bar;
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
        appendAssistant(m.text, m.meta);
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

    const clientStartTime = Date.now();
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

    const node = appendAssistant("", null);
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
            assistantText += msg.text || "";
            updateAssistantMessage(node, assistantText, false, null);
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
              assistantText = msg.text;
            }
            finalEdits = msg.edits || [];
            finalMode = msg.mode || modeEl.value;

            const meta = {
              durationMs: msg.durationMs != null ? msg.durationMs : (Date.now() - clientStartTime),
              usage: msg.usage,
              rateLimit: msg.rateLimit,
            };
            updateAssistantMessage(node, assistantText, true, meta);

            // Save assistant message with metadata to persistent thread
            thread.messages.push({
              role: "assistant",
              text: assistantText,
              meta,
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

  // Configure Monaco Worker environment for offline local loading without URL parse errors
  window.MonacoEnvironment = {
    getWorkerUrl: function (_moduleId, label) {
      const base = window.location.origin + "/static/vendor/monaco/min/";
      return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
        self.MonacoEnvironment = { baseUrl: '${base}' };
        importScripts('${base}vs/base/worker/workerMain.js');
      `)}`;
    },
  };

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

    initInlineEdit(editor);
    initCursorTab(editor);

    loadMeta();
    loadChatThreads();
  });

  function initCursorTab(editorInstance) {
    let enabled = true;
    let timer = null;

    try {
      monaco.languages.registerInlineCompletionsProvider({ pattern: "**" }, {
        provideInlineCompletions: async (model, position, context, token) => {
          if (!enabled) return { items: [] };

          await new Promise((resolve) => {
            clearTimeout(timer);
            timer = setTimeout(resolve, 280);
          });
          if (token.isCancellationRequested) return { items: [] };

          const line = model.getLineContent(position.lineNumber);
          if (!line.trim()) return { items: [] };

          const fullText = model.getValue();
          const offset = model.getOffsetAt(position);
          const prefix = fullText.slice(0, offset);
          const suffix = fullText.slice(offset);

          try {
            const res = await fetch("/api/autocomplete", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                prefix,
                suffix,
                language: model.getLanguageId(),
              }),
            });
            const data = await res.json();
            if (data.ok && data.completion && data.completion.trim()) {
              return {
                items: [
                  {
                    insertText: data.completion,
                    range: new monaco.Range(
                      position.lineNumber,
                      position.column,
                      position.lineNumber,
                      position.column
                    ),
                  },
                ],
              };
            }
          } catch {
            // ignore
          }
          return { items: [] };
        },
        freeInlineCompletions: () => {},
      });
    } catch (e) {
      console.warn("Cursor Tab inline completions provider init:", e);
    }
  }

  function initInlineEdit(editorInstance) {
    let widget = document.getElementById("inline-edit-widget");
    if (!widget) {
      widget = document.createElement("div");
      widget.id = "inline-edit-widget";
      widget.className = "inline-edit-widget";
      widget.innerHTML = `
        <div class="inline-edit-header">
          <span class="inline-edit-title">✨ Cursor Inline Edit (Ctrl+K)</span>
          <span class="inline-edit-hint">Enter para generar · Esc para cerrar</span>
        </div>
        <div class="inline-edit-body">
          <input type="text" id="inline-edit-input" class="inline-edit-input" placeholder="Instrucción (ej: 'añadir validación', 'convertir a async')..." />
          <button id="inline-edit-btn" class="inline-edit-submit">Generar</button>
        </div>
        <div id="inline-edit-actions" class="inline-edit-actions" style="display:none;">
          <span class="inline-edit-status">Cambios aplicados inline:</span>
          <button id="inline-edit-accept" class="btn-action-accept">✓ Aceptar (Ctrl+Enter)</button>
          <button id="inline-edit-reject" class="btn-action-reject">✕ Descartar (Esc)</button>
        </div>
      `;
      document.body.appendChild(widget);
    }

    let originalSelection = null;
    let originalText = "";

    function openInlineEdit() {
      const model = editorInstance.getModel();
      if (!model) return;
      originalSelection = editorInstance.getSelection() || new monaco.Selection(1, 1, 1, 1);
      originalText = model.getValueInRange(originalSelection);

      widget.style.display = "flex";
      const input = document.getElementById("inline-edit-input");
      input.value = "";
      document.getElementById("inline-edit-actions").style.display = "none";
      input.focus();
    }

    function closeInlineEdit() {
      widget.style.display = "none";
      editorInstance.focus();
    }

    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
      openInlineEdit();
    });

    // Global shortcut fallback
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        if (widget.style.display !== "flex") {
          e.preventDefault();
          openInlineEdit();
        }
      }
    });

    const input = document.getElementById("inline-edit-input");
    const submitBtn = document.getElementById("inline-edit-btn");
    const acceptBtn = document.getElementById("inline-edit-accept");
    const rejectBtn = document.getElementById("inline-edit-reject");

    async function executeInline() {
      const prompt = input.value.trim();
      if (!prompt) return;
      submitBtn.disabled = true;
      submitBtn.textContent = "Generando…";
      try {
        const res = await fetch("/api/inline-edit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt,
            code: originalText,
            path: activePath,
            fullContent: editorInstance.getModel()?.getValue() || "",
          }),
        });
        const data = await res.json();
        if (data.ok && typeof data.replacement === "string") {
          editorInstance.executeEdits("inline-edit", [
            { range: originalSelection, text: data.replacement, forceMoveMarkers: true },
          ]);
          document.getElementById("inline-edit-actions").style.display = "flex";
        }
      } catch (err) {
        console.error(err);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Generar";
      }
    }

    submitBtn.addEventListener("click", executeInline);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        executeInline();
      } else if (e.key === "Escape") {
        closeInlineEdit();
      }
    });

    acceptBtn.addEventListener("click", () => {
      closeInlineEdit();
    });

    rejectBtn.addEventListener("click", () => {
      if (originalSelection) {
        editorInstance.executeEdits("inline-edit-reject", [
          { range: originalSelection, text: originalText, forceMoveMarkers: true },
        ]);
      }
      closeInlineEdit();
    });
  }

  function initComposer() {
    let overlay = document.getElementById("composer-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "composer-overlay";
      overlay.className = "composer-overlay";
      overlay.innerHTML = `
        <div class="composer-modal">
          <div class="composer-header">
            <span class="composer-title">✨ Cursor Composer (Ctrl+I)</span>
            <div style="display:flex; gap:8px; align-items:center;">
              <button id="composer-btn-rollback" class="composer-rollback-btn" title="Revertir cambios al checkpoint anterior">⏪ Rollback</button>
              <button id="composer-btn-close" style="background:none; border:none; color:#94a3b8; cursor:pointer; font-size:18px;">✕</button>
            </div>
          </div>
          <div class="composer-body">
            <textarea id="composer-textarea" class="composer-input" placeholder="Describe los cambios multi-archivo que deseas generar... (ej: 'Crea un servicio de autenticación y modula las rutas')"></textarea>
            <div class="composer-controls">
              <span style="font-size:12px; color:#64748b;">Ctrl+Enter para enviar</span>
              <div class="composer-actions">
                <button id="composer-btn-submit" class="btn-primary" style="background:#6366f1; color:white; border:none; border-radius:6px; padding:7px 14px; font-weight:500; cursor:pointer;">Generar cambios</button>
              </div>
            </div>
            <div id="composer-files-tree" class="composer-files-tree">
              <span style="font-size:12px; font-weight:600; color:#cbd5e1;">Archivos modificados:</span>
              <div id="composer-files-list"></div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    const textarea = document.getElementById("composer-textarea");
    const closeBtn = document.getElementById("composer-btn-close");
    const submitBtn = document.getElementById("composer-btn-submit");
    const rollbackBtn = document.getElementById("composer-btn-rollback");
    const filesTree = document.getElementById("composer-files-tree");
    const filesList = document.getElementById("composer-files-list");

    function openComposer() {
      overlay.style.display = "flex";
      textarea.focus();
    }

    function closeComposer() {
      overlay.style.display = "none";
    }

    closeBtn.addEventListener("click", closeComposer);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeComposer();
    });

    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "i" || e.key === "I")) {
        e.preventDefault();
        openComposer();
      } else if (e.key === "Escape" && overlay.style.display === "flex") {
        closeComposer();
      }
    });

    rollbackBtn.addEventListener("click", async () => {
      rollbackBtn.disabled = true;
      rollbackBtn.textContent = "Revertiendo…";
      try {
        const res = await fetch("/api/composer/rollback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
        const data = await res.json();
        if (data.ok) {
          alert("✓ Rollback exitoso: archivos restaurados al checkpoint anterior.");
          if (activePath) openPath(activePath);
          loadTree();
        } else {
          alert("No hay checkpoints disponibles para revertir.");
        }
      } catch (err) {
        alert("Error al revertir: " + err.message);
      } finally {
        rollbackBtn.disabled = false;
        rollbackBtn.textContent = "⏪ Rollback";
      }
    });

    async function sendComposer() {
      const text = textarea.value.trim();
      if (!text) return;
      submitBtn.disabled = true;
      submitBtn.textContent = "Generando multi-archivo…";
      filesTree.style.display = "none";
      filesList.innerHTML = "";

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text,
            mode: "autonomous",
            activePath,
          }),
        });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() || "";
          for (const chunk of parts) {
            const trimmed = chunk.trim();
            if (!trimmed.startsWith("data:")) continue;
            try {
              const ev = JSON.parse(trimmed.slice(5).trim());
              if (ev.type === "done" && ev.edits && ev.edits.length > 0) {
                filesTree.style.display = "flex";
                filesList.innerHTML = ev.edits.map(ed => `
                  <div class="composer-file-row">
                    <span style="display: flex; align-items: center; gap: 6px;">${getFileIconHtml(ed.path)} <strong>${escapeHtml(ed.path)}</strong> (${ed.kind || "modificado"})</span>
                    <button class="btn-action-accept" onclick="openPath('${escapeHtml(ed.path)}')">Abrir</button>
                  </div>
                `).join("");
                loadTree();
                if (activePath) openPath(activePath);
              }
            } catch {}
          }
        }
      } catch (err) {
        console.error("Error en Composer:", err);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Generar cambios";
      }
    }

    submitBtn.addEventListener("click", sendComposer);
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendComposer();
      }
    });
  }

  initComposer();
})();
