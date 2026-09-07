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

  // Responsive Layout & View Mode
  let explorerVisible = true;
  let isClaudeMode = false;
  const btnToggleView = document.getElementById("btn-toggle-view");

  function applyShellLayout() {
    const w = window.innerWidth;
    const spec = (globalThis.FhCodeLayout && globalThis.FhCodeLayout.layoutForWidth)
      ? globalThis.FhCodeLayout.layoutForWidth(w)
      : { columns: "240px minmax(0, 1fr) 340px", chatDisplay: "flex" };
    const shell = document.querySelector(".shell");
    const chat = document.querySelector(".chat");

    if (shell) {
      if (!explorerVisible) {
        shell.classList.add("explorer-collapsed");
        const rightCol = w < 980 ? "minmax(180px, 28vw)" : (w < 1200 ? "290px" : "340px");
        shell.style.gridTemplateColumns = `0px minmax(0, 1fr) ${rightCol}`;
      } else {
        shell.classList.remove("explorer-collapsed");
        shell.style.gridTemplateColumns = spec.columns;
      }
    }
    if (chat) chat.style.display = spec.chatDisplay;
  }

  function toggleClaudeMode() {
    isClaudeMode = !isClaudeMode;
    const btnText = btnToggleView ? btnToggleView.querySelector(".btn-text") : null;
    if (isClaudeMode) {
      document.body.classList.add("claude-desktop-mode");
      if (btnText) btnText.textContent = "Modo IDE";
      if (typeof openChatInDocument === "function") {
        openChatInDocument(currentChatId || (chatThreads[0] && chatThreads[0].id));
      }
    } else {
      document.body.classList.remove("claude-desktop-mode");
      if (btnText) btnText.textContent = "Modo Claude";
    }
    applyShellLayout();
    if (editor) editor.layout();
    if (diffEditor) diffEditor.layout();
  }
  if (btnToggleView) {
    btnToggleView.addEventListener("click", toggleClaudeMode);
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

  let disabledModels = [];
  let disabledProviders = [];

  const ALL_PROVIDERS = [
    { id: "claude", label: "Claude" },
    { id: "grok", label: "Grok" },
    { id: "openai", label: "OpenAI" },
    { id: "fcc", label: "FCC" },
  ];

  function fillProviders() {
    const currentVal = providerEl.value;
    const available = ALL_PROVIDERS.filter((p) => !disabledProviders.includes(p.id));
    providerEl.innerHTML = "";
    if (available.length === 0) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "(Ningún proveedor habilitado)";
      providerEl.appendChild(o);
    } else {
      available.forEach((p) => {
        const o = document.createElement("option");
        o.value = p.id;
        o.textContent = p.label;
        providerEl.appendChild(o);
      });
      if (available.some((p) => p.id === currentVal)) {
        providerEl.value = currentVal;
      } else if (available.length > 0) {
        providerEl.value = available[0].id;
      }
    }
    fillModels();
  }

  function fillModels() {
    const id = providerEl.value;
    if (!id) {
      modelEl.innerHTML = '<option value="">(Ningún modelo habilitado)</option>';
      return;
    }
    const all = (catalog[id] || []).slice();
    const list = all.filter((m) => !disabledModels.includes(m));
    modelEl.innerHTML = "";
    if (list.length === 0) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "(Ningún modelo habilitado)";
      modelEl.appendChild(o);
    } else {
      list.forEach((m) => {
        const o = document.createElement("option");
        o.value = m;
        o.textContent = m;
        modelEl.appendChild(o);
      });
      if (list.length) modelEl.value = list[0];
    }
    if (typeof renderAiLimitsBar === "function") renderAiLimitsBar();
  }

  async function loadMeta() {
    const meta = await (await fetch("/api/meta")).json();
    wsName.textContent = meta.name + " — " + meta.root;
    wsName.title = meta.root;
    catalog = meta.catalog || meta.models || {};
    if (meta.settings && Array.isArray(meta.settings["fhIa.disabledModels"])) {
      disabledModels = [...meta.settings["fhIa.disabledModels"]];
    } else {
      disabledModels = [];
    }
    if (meta.settings && Array.isArray(meta.settings["fhIa.disabledProviders"])) {
      disabledProviders = [...meta.settings["fhIa.disabledProviders"]];
    } else {
      disabledProviders = [];
    }
    ALL_PROVIDERS.forEach(({ id }) => {
      if (meta.settings && meta.settings[`fhIa.${id}.enabled`] === false && !disabledProviders.includes(id)) {
        disabledProviders.push(id);
      }
    });
    fillProviders();
    if (meta.provider && !disabledProviders.includes(meta.provider)) {
      providerEl.value = meta.provider;
      fillModels();
    }
    populateSettingsModelSelects(catalog);
    renderModelTogglesList(catalog);
    renderProviderMasterToggles();
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

  function sortClientTreeEntries(a, b) {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    if (a.dir) return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

    // Files: sort by type (extension) first
    const hasDotA = a.name.includes(".");
    const hasDotB = b.name.includes(".");
    const extA = hasDotA ? (a.name.split(".").pop() || "").toLowerCase() : "";
    const extB = hasDotB ? (b.name.split(".").pop() || "").toLowerCase() : "";

    if (extA !== extB) {
      if (!extA) return 1;
      if (!extB) return -1;
      return extA.localeCompare(extB, undefined, { sensitivity: "base", numeric: true });
    }

    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  }

  // File Tree
  async function loadTree(dir = ".", into = treeEl) {
    try {
      const data = await (await fetch("/api/tree?dir=" + encodeURIComponent(dir))).json();
      into.innerHTML = "";
      const entries = (data.entries || []).slice().sort(sortClientTreeEntries);
      for (const ent of entries) {
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

        itemRow.addEventListener("click", async (ev) => {
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
    } catch (err) {
      console.error("[loadTree error]", err);
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
    try {
      if (isDiffMode) closeDiffView();
      if (isClaudeMode) toggleClaudeMode();
      activeTabType = "file";
      activePath = p;

      let tab = openTabs.find((t) => t.type !== "chat" && t.path === p);
      if (!tab) {
        const res = await fetch("/api/file?path=" + encodeURIComponent(p));
        if (!res.ok) {
          throw new Error(`Error ${res.status}: no se pudo leer el archivo`);
        }
        const data = await res.json();
        const content = typeof data.content === "string" ? data.content : "";
        let model = null;
        if (typeof monaco !== "undefined" && monaco.editor) {
          const cleanPath = p.replace(/^\/+/, "");
          const uri = monaco.Uri.parse(`inmemory://workspace/${cleanPath}`);
          model = monaco.editor.getModel(uri);
          if (!model) {
            model = monaco.editor.createModel(content, langOf(p), uri);
          } else {
            model.setValue(content);
          }
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

      if (editor) {
        if (tab.model) {
          editor.setModel(tab.model);
          triggerLspDiagnostics(p, tab.model.getValue(), langOf(p), tab.model);
        }
        editor.layout();
      }

      document.querySelectorAll(".tree-row.file-row").forEach((el) => {
        el.classList.toggle("active", el.getAttribute("data-path") === p);
      });
      if (typeof renderChatSidebar === "function") renderChatSidebar();
    } catch (err) {
      console.error("[openFile error]", err);
      alert("No se pudo abrir el archivo: " + (err.message || String(err)));
    }
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
    { id: "select-claude", label: "Usar IA: Claude", hint: "", run: () => { if (!disabledProviders.includes("claude")) { providerEl.value = "claude"; fillModels(); } else { alert("El proveedor Claude está deshabilitado en Ajustes."); } } },
    { id: "select-grok", label: "Usar IA: Grok", hint: "", run: () => { if (!disabledProviders.includes("grok")) { providerEl.value = "grok"; fillModels(); } else { alert("El proveedor Grok está deshabilitado en Ajustes."); } } },
    { id: "select-openai", label: "Usar IA: OpenAI-Compatible", hint: "", run: () => { if (!disabledProviders.includes("openai")) { providerEl.value = "openai"; fillModels(); } else { alert("El proveedor OpenAI está deshabilitado en Ajustes."); } } },
    { id: "select-fcc", label: "Usar IA: FCC (Free Claude Code)", hint: "", run: () => { if (!disabledProviders.includes("fcc")) { providerEl.value = "fcc"; fillModels(); } else { alert("El proveedor FCC está deshabilitado en Ajustes."); } } },
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
      const sbGit = document.getElementById("sb-git-text");
      if (sbGit) sbGit.textContent = res.branch || "main";
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

  function renderProviderMasterToggles() {
    ALL_PROVIDERS.forEach(({ id }) => {
      const chk = document.getElementById(`toggle-prov-${id}`);
      const item = document.getElementById(`item-prov-${id}`);
      const badge = document.getElementById(`status-badge-${id}`);
      const card = document.getElementById(`card-provider-${id}`);
      const drawer = document.getElementById(`drawer-${id}`);

      const isEnabled = !disabledProviders.includes(id);

      if (chk) chk.checked = isEnabled;
      if (item) {
        if (isEnabled) item.classList.remove("disabled");
        else item.classList.add("disabled");
      }
      if (badge) {
        badge.className = "provider-status-badge " + (isEnabled ? "enabled" : "disabled");
        badge.textContent = isEnabled ? "Activo" : "Inactivo";
      }
      if (card) {
        if (isEnabled) card.classList.remove("provider-disabled");
        else card.classList.add("provider-disabled");
      }
      if (drawer) {
        if (isEnabled) drawer.classList.remove("provider-disabled");
        else drawer.classList.add("provider-disabled");
      }
    });
  }

  function setupProviderMasterToggles() {
    ALL_PROVIDERS.forEach(({ id }) => {
      const chk = document.getElementById(`toggle-prov-${id}`);
      if (!chk) return;
      chk.onchange = () => {
        if (!chk.checked) {
          const enabledCount = ALL_PROVIDERS.filter((p) => !disabledProviders.includes(p.id)).length;
          if (enabledCount <= 1) {
            chk.checked = true;
            alert("Debe haber al menos un proveedor de IA habilitado.");
            return;
          }
          if (!disabledProviders.includes(id)) disabledProviders.push(id);
        } else {
          disabledProviders = disabledProviders.filter((p) => p !== id);
        }
        renderProviderMasterToggles();
        fillProviders();
      };
    });
  }

  // Settings Modal (Issue #13)
  function applySettingsToUi(settings) {
    if (Array.isArray(settings["fhIa.disabledModels"])) {
      disabledModels = [...settings["fhIa.disabledModels"]];
      fillModels();
      populateSettingsModelSelects(catalog);
      renderModelTogglesList(catalog);
    }

    if (Array.isArray(settings["fhIa.disabledProviders"])) {
      disabledProviders = [...settings["fhIa.disabledProviders"]];
    }
    ALL_PROVIDERS.forEach(({ id }) => {
      if (settings[`fhIa.${id}.enabled`] === false && !disabledProviders.includes(id)) {
        disabledProviders.push(id);
      }
    });
    fillProviders();
    renderProviderMasterToggles();

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

  let currentAccounts = [];
  const accountModal = document.getElementById("account-modal");
  const btnAccountModalClose = document.getElementById("btn-account-modal-close");
  const btnAccountCancel = document.getElementById("btn-account-cancel");
  const btnAccountSave = document.getElementById("btn-account-save");
  const btnAddAccount = document.getElementById("btn-add-account");
  let editingAccountId = null;

  function renderAccountsList() {
    const listEl = document.getElementById("accounts-list");
    const emptyEl = document.getElementById("accounts-empty");
    if (!listEl) return;
    listEl.innerHTML = "";
    if (currentAccounts.length === 0) {
      if (emptyEl) emptyEl.style.display = "block";
      return;
    }
    if (emptyEl) emptyEl.style.display = "none";

    currentAccounts.forEach((acc, idx) => {
      const card = document.createElement("div");
      card.className = "account-card" + (acc.enabled === false ? " disabled" : "");

      const left = document.createElement("div");
      left.className = "account-card-left";

      const badge = document.createElement("span");
      badge.className = `account-badge ${acc.provider || "claude"}`;
      badge.textContent = (acc.provider || "IA").toUpperCase();

      const isWeb = acc.authType === "web" || acc.authKind === "session";
      const typeBadge = document.createElement("span");
      typeBadge.className = `account-type-badge ${isWeb ? "web" : "apikey"}`;
      typeBadge.textContent = isWeb ? "Web / Login" : "API Key";

      const meta = document.createElement("div");
      meta.className = "account-meta";

      const title = document.createElement("div");
      title.className = "account-title";
      title.textContent = acc.name || `Cuenta ${acc.provider}`;

      const sub = document.createElement("div");
      sub.className = "account-sub";
      const keyStr = String(acc.apiKey || "");
      const maskedKey = keyStr ? (keyStr.length > 8 ? `${keyStr.slice(0, 4)}••••${keyStr.slice(-4)}` : "••••••••") : "Sin clave";
      sub.textContent = `${maskedKey}${acc.model ? ` · ${acc.model}` : ""}`;

      meta.appendChild(title);
      meta.appendChild(sub);
      left.appendChild(badge);
      left.appendChild(typeBadge);
      left.appendChild(meta);

      const right = document.createElement("div");
      right.className = "account-card-right";

      const switchLabel = document.createElement("label");
      switchLabel.className = "toggle-switch";
      switchLabel.title = acc.enabled === false ? "Cuenta deshabilitada" : "Cuenta activa";
      const switchInput = document.createElement("input");
      switchInput.type = "checkbox";
      switchInput.checked = acc.enabled !== false;
      switchInput.addEventListener("change", (e) => {
        acc.enabled = e.target.checked;
        renderAccountsList();
      });
      const slider = document.createElement("span");
      slider.className = "toggle-slider";
      switchLabel.appendChild(switchInput);
      switchLabel.appendChild(slider);

      const btnEdit = document.createElement("button");
      btnEdit.className = "btn-icon-subtle";
      btnEdit.type = "button";
      btnEdit.title = "Editar cuenta";
      btnEdit.innerHTML = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2l3 3L5 14H2v-3L11 2z"/></svg>`;
      btnEdit.addEventListener("click", () => openAccountModal(acc));

      const btnDel = document.createElement("button");
      btnDel.className = "btn-icon-subtle danger";
      btnDel.type = "button";
      btnDel.title = "Eliminar cuenta";
      btnDel.innerHTML = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h10M6 4V2h4v2M5 4v9h6V4"/></svg>`;
      btnDel.addEventListener("click", () => {
        if (confirm(`¿Eliminar la cuenta "${acc.name || acc.provider}"?`)) {
          currentAccounts.splice(idx, 1);
          renderAccountsList();
        }
      });

      right.appendChild(switchLabel);
      right.appendChild(btnEdit);
      right.appendChild(btnDel);

      card.appendChild(left);
      card.appendChild(right);
      listEl.appendChild(card);
    });
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        // fallback below
      }
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  function getCookieExtractionScript(provider) {
    if (provider === "openai") {
      return `(()=>{fetch('/api/auth/session').then(r=>r.json()).then(d=>{const t=d.accessToken||(document.cookie.match(/__Secure-next-auth\\.session-token=([^;]+)/)||[])[1];if(typeof copy==='function'){copy(t);}else{navigator.clipboard.writeText(t);}alert('✓ Token de sesión de ChatGPT copiado! Vuelve a fh-code y pégalo.');}).catch(()=>{const c=(document.cookie.match(/__Secure-next-auth\\.session-token=([^;]+)/)||[])[1]||document.cookie;if(typeof copy==='function'){copy(c);}else{navigator.clipboard.writeText(c);}alert('✓ Cookie copiada al portapapeles!');});})()`;
    }
    if (provider === "grok") {
      return `(()=>{const c=(document.cookie.match(/(?:sso|xai-session|sso-rw)=([^;]+)/)||[])[1]||document.cookie;if(typeof copy==='function'){copy(c);}else{navigator.clipboard.writeText(c);}alert('✓ Cookie de Grok copiada al portapapeles! Vuelve a fh-code y pégala.');})()`;
    }
    // Default: Claude
    return `(()=>{const c=(document.cookie.match(/sessionKey=([^;]+)/)||[])[1]||document.cookie;if(typeof copy==='function'){copy(c);}else{navigator.clipboard.writeText(c);}alert('✓ Cookie sessionKey de Claude copiada al portapapeles! Vuelve a fh-code y pégala.');})()`;
  }

  function extractTokenFromRawInput(raw, provider) {
    if (!raw || typeof raw !== "string") return "";
    let clean = raw.trim();

    if (clean.toLowerCase().startsWith("bearer ")) {
      clean = clean.slice(7).trim();
    }

    if (clean.startsWith("{") && clean.endsWith("}")) {
      try {
        const parsed = JSON.parse(clean);
        if (parsed.accessToken) return parsed.accessToken;
        if (parsed.token) return parsed.token;
        if (parsed.sessionKey) return parsed.sessionKey;
        if (parsed.apiKey) return parsed.apiKey;
      } catch {}
    }

    if (provider === "claude") {
      const claudeKeyMatch = clean.match(/sk-ant-sid01-[A-Za-z0-9_-]+/);
      if (claudeKeyMatch) return claudeKeyMatch[0];
      const sessionKeyMatch = clean.match(/sessionKey=([^; \r\n]+)/i);
      if (sessionKeyMatch) return sessionKeyMatch[1];
    }

    if (provider === "openai") {
      const nextAuthMatch = clean.match(/__Secure-next-auth\.session-token=([^; \r\n]+)/i);
      if (nextAuthMatch) return nextAuthMatch[1];
      const jwtMatch = clean.match(/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]+/);
      if (jwtMatch) return jwtMatch[0];
    }

    if (provider === "grok") {
      const grokMatch = clean.match(/(?:sso|xai-session|sso-rw)=([^; \r\n]+)/i);
      if (grokMatch) return grokMatch[1];
    }

    if (clean.includes("=")) {
      if (/^cookie:\s*/i.test(clean)) {
        clean = clean.replace(/^cookie:\s*/i, "");
      }
      const genericMatch = clean.match(/(?:sessionKey|session-token|session_token|accessToken|token)=([^; \r\n]+)/i);
      if (genericMatch) return genericMatch[1];
    }

    clean = clean.replace(/^["']|["']$/g, "").trim();
    return clean;
  }

  function updateWebCookieAssistant(provider) {
    const linkOpen = document.getElementById("acc-link-open-web");
    const linkOpenText = document.getElementById("acc-link-open-text");
    const stepText = document.getElementById("acc-cookie-step-text");

    let url = "https://claude.ai";
    let label = "1. Abrir claude.ai ↗";
    let guide = "1. Clic en <strong>Copiar extractor</strong> &rarr; 2. En claude.ai presiona <strong>F12</strong> (Consola), pega y dale <strong>Enter</strong> &rarr; 3. Clic en <strong>Pegar cookie</strong>.";

    if (provider === "openai") {
      url = "https://chatgpt.com";
      label = "1. Abrir chatgpt.com ↗";
      guide = "1. Clic en <strong>Copiar extractor</strong> &rarr; 2. En chatgpt.com presiona <strong>F12</strong> (Consola), pega y dale <strong>Enter</strong> &rarr; 3. Clic en <strong>Pegar cookie</strong>.";
    } else if (provider === "grok") {
      url = "https://grok.com";
      label = "1. Abrir grok.com ↗";
      guide = "1. Clic en <strong>Copiar extractor</strong> &rarr; 2. En grok.com presiona <strong>F12</strong> (Consola), pega y dale <strong>Enter</strong> &rarr; 3. Clic en <strong>Pegar cookie</strong>.";
    }

    if (linkOpen) linkOpen.href = url;
    if (linkOpenText) linkOpenText.textContent = label;
  }

  function syncProviderChips(provider) {
    const chips = document.querySelectorAll(".acc-prov-chip");
    chips.forEach((c) => {
      if (c.dataset.provider === provider) c.classList.add("active");
      else c.classList.remove("active");
    });
    const providerSelect = document.getElementById("acc-provider");
    if (providerSelect) providerSelect.value = provider;
  }

  function setAccountAuthType(type) {
    const hiddenType = document.getElementById("acc-auth-type");
    if (hiddenType) hiddenType.value = type;

    const tabApiKey = document.getElementById("acc-tab-apikey");
    const tabWeb = document.getElementById("acc-tab-web");
    const webActions = document.getElementById("acc-web-actions");
    const credTitle = document.getElementById("acc-cred-title");
    const credDesc = document.getElementById("acc-cred-desc");
    const keyInput = document.getElementById("acc-key");
    const providerSelect = document.getElementById("acc-provider");
    let providerVal = providerSelect ? providerSelect.value : "claude";

    const methodCard = document.getElementById("acc-method-step-card");
    if (providerVal === "fcc") {
      type = "apiKey";
      if (hiddenType) hiddenType.value = "apiKey";
      if (methodCard) methodCard.style.display = "none";
    } else {
      if (methodCard) methodCard.style.display = "flex";
    }

    if (type === "web") {
      if (tabApiKey) tabApiKey.classList.remove("active");
      if (tabWeb) tabWeb.classList.add("active");
      if (webActions) webActions.style.display = "flex";
      if (credTitle) credTitle.textContent = "Conexión con Cuenta Web";
      if (credDesc) credDesc.textContent = "Pega tu token de sesión o cookie aquí";
      if (keyInput) {
        if (providerVal === "claude") {
          keyInput.placeholder = "Pega tu sessionKey (sk-ant-sid01-...)";
        } else if (providerVal === "openai") {
          keyInput.placeholder = "Pega tu token o cookie de sesión de ChatGPT";
        } else if (providerVal === "grok") {
          keyInput.placeholder = "Pega tu cookie de sesión de Grok";
        } else {
          keyInput.placeholder = "Pega tu token o cookie de sesión";
        }
      }
      updateWebCookieAssistant(providerVal);
    } else {
      if (tabApiKey) tabApiKey.classList.add("active");
      if (tabWeb) tabWeb.classList.remove("active");
      if (webActions) webActions.style.display = "none";
      if (credTitle) credTitle.textContent = "Introduce tu API Key";
      if (credDesc) credDesc.textContent = "Clave secreta oficial de API";
      if (keyInput) {
        if (providerVal === "claude") keyInput.placeholder = "sk-ant-...";
        else if (providerVal === "openai") keyInput.placeholder = "sk-...";
        else if (providerVal === "grok") keyInput.placeholder = "xai-...";
        else if (providerVal === "fcc") keyInput.placeholder = "Bearer token o proxy key (opcional)";
        else keyInput.placeholder = "sk-...";
      }
    }
  }

  function openAccountModal(acc) {
    if (!accountModal) return;
    const detectStatus = document.getElementById("acc-detect-status");
    if (detectStatus) {
      detectStatus.textContent = "";
      detectStatus.className = "acc-detect-status";
    }
    const cookieStatus = document.getElementById("acc-cookie-status");
    if (cookieStatus) {
      cookieStatus.style.display = "none";
      cookieStatus.textContent = "";
      cookieStatus.className = "acc-cookie-status";
    }
    const btnCopyText = document.getElementById("btn-copy-cookie-text");
    if (btnCopyText) btnCopyText.textContent = "Copiar de mi navegador (1 clic)";
    const btnCopy = document.getElementById("btn-copy-cookie-script");
    if (btnCopy) btnCopy.classList.remove("copied");

    const keyInput = document.getElementById("acc-key");
    if (keyInput) keyInput.type = "password";

    const details = document.querySelector("#account-modal .acc-advanced-details");

    if (acc) {
      editingAccountId = acc.id;
      document.getElementById("account-modal-title").textContent = "Editar Proveedor de IA";
      document.getElementById("acc-id").value = acc.id;
      document.getElementById("acc-name").value = acc.name || "";
      document.getElementById("acc-key").value = acc.apiKey || "";
      document.getElementById("acc-base").value = acc.baseUrl || "";
      document.getElementById("acc-model").value = acc.model || "";
      document.getElementById("acc-enabled").checked = acc.enabled !== false;
      const prov = acc.provider || "claude";
      syncProviderChips(prov);
      const initialType = acc.authType === "web" || acc.authKind === "session" ? "web" : "apiKey";
      setAccountAuthType(initialType);
      if (details) details.open = !!(acc.baseUrl || acc.model || acc.name);
    } else {
      editingAccountId = null;
      document.getElementById("account-modal-title").textContent = "Añadir Proveedor de IA";
      document.getElementById("acc-id").value = "";
      document.getElementById("acc-name").value = "";
      document.getElementById("acc-key").value = "";
      document.getElementById("acc-base").value = "";
      document.getElementById("acc-model").value = "";
      document.getElementById("acc-enabled").checked = true;
      syncProviderChips("claude");
      setAccountAuthType("web");
      if (details) details.open = false;
    }
    accountModal.style.display = "flex";
  }

  function closeAccountModal() {
    if (accountModal) accountModal.style.display = "none";
    editingAccountId = null;
  }

  const accTabApiKey = document.getElementById("acc-tab-apikey");
  const accTabWeb = document.getElementById("acc-tab-web");
  if (accTabApiKey) {
    accTabApiKey.addEventListener("click", () => setAccountAuthType("apiKey"));
  }
  if (accTabWeb) {
    accTabWeb.addEventListener("click", () => setAccountAuthType("web"));
  }

  document.querySelectorAll(".acc-prov-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const prov = chip.dataset.provider;
      syncProviderChips(prov);
      const currentType = document.getElementById("acc-auth-type")?.value || "web";
      setAccountAuthType(currentType);
    });
  });

  const accProviderSelect = document.getElementById("acc-provider");
  if (accProviderSelect) {
    accProviderSelect.addEventListener("change", () => {
      syncProviderChips(accProviderSelect.value);
      const currentType = document.getElementById("acc-auth-type")?.value || "web";
      setAccountAuthType(currentType);
    });
  }

  // 1-Click Cookie Extractor Script Button
  const btnCopyCookieScript = document.getElementById("btn-copy-cookie-script");
  if (btnCopyCookieScript) {
    btnCopyCookieScript.addEventListener("click", async () => {
      const provider = document.getElementById("acc-provider")?.value || "claude";
      const script = getCookieExtractionScript(provider);
      const ok = await copyTextToClipboard(script);
      const textSpan = document.getElementById("btn-copy-cookie-text");
      const statusEl = document.getElementById("acc-cookie-status");

      if (ok) {
        if (textSpan) textSpan.textContent = "✓ ¡Comando copiado!";
        btnCopyCookieScript.classList.add("copied");
        if (statusEl) {
          statusEl.style.display = "block";
          statusEl.className = "acc-cookie-status info";
          const provDomain = provider === "openai" ? "chatgpt.com" : (provider === "grok" ? "grok.com" : "claude.ai");
          statusEl.innerHTML = `✓ <strong>Comando copiado</strong>. En <em>${provDomain}</em> pulsa <strong>F12</strong> (Consola), pega (Ctrl+V) y dale <strong>Enter</strong>. ¡Luego haz clic en 'Pegar cookie'!`;
        }
        setTimeout(() => {
          if (textSpan) textSpan.textContent = "Copiar de mi navegador (1 clic)";
          btnCopyCookieScript.classList.remove("copied");
        }, 4000);
      } else {
        if (statusEl) {
          statusEl.style.display = "block";
          statusEl.className = "acc-cookie-status error";
          statusEl.textContent = "No se pudo copiar automáticamente. Por favor copia el comando manualmente.";
        }
      }
    });
  }

  // Paste and Auto-Extract Cookie Button
  const btnPasteCookie = document.getElementById("btn-paste-cookie");
  if (btnPasteCookie) {
    btnPasteCookie.addEventListener("click", async () => {
      const provider = document.getElementById("acc-provider")?.value || "claude";
      const statusEl = document.getElementById("acc-cookie-status");
      const keyInput = document.getElementById("acc-key");

      let text = "";
      if (navigator.clipboard && navigator.clipboard.readText) {
        try {
          text = await navigator.clipboard.readText();
        } catch (e) {
          // Clipboard read blocked by browser permissions
        }
      }

      if (!text && keyInput && keyInput.value) {
        text = keyInput.value;
      }

      if (!text) {
        if (keyInput) {
          keyInput.focus();
          keyInput.placeholder = "Pega aquí tu cookie o token con Ctrl+V...";
        }
        if (statusEl) {
          statusEl.style.display = "block";
          statusEl.className = "acc-cookie-status info";
          statusEl.textContent = "Presiona Ctrl+V en el campo de credencial para pegar tu cookie.";
        }
        return;
      }

      const extracted = extractTokenFromRawInput(text, provider);
      if (extracted) {
        if (keyInput) {
          keyInput.value = extracted;
          keyInput.type = "text";
          setTimeout(() => {
            if (keyInput) keyInput.type = "password";
          }, 3500);
        }
        const nameInput = document.getElementById("acc-name");
        if (nameInput && !nameInput.value.trim()) {
          nameInput.value = provider === "openai" ? "ChatGPT (Cookie Web)" : (provider === "grok" ? "Grok (Cookie Web)" : "Claude (Cookie Web)");
        }
        if (statusEl) {
          statusEl.style.display = "block";
          statusEl.className = "acc-cookie-status success";
          statusEl.textContent = "✓ ¡Cookie extraída y aplicada con éxito!";
        }
      } else {
        if (statusEl) {
          statusEl.style.display = "block";
          statusEl.className = "acc-cookie-status error";
          statusEl.textContent = "No se reconoció una cookie o token válido en el portapapeles.";
        }
      }
    });
  }

  // Auto-clean on paste into the key field
  const accKeyField = document.getElementById("acc-key");
  if (accKeyField) {
    accKeyField.addEventListener("paste", () => {
      const authType = document.getElementById("acc-auth-type")?.value || "apiKey";
      if (authType !== "web") return;
      setTimeout(() => {
        const provider = document.getElementById("acc-provider")?.value || "claude";
        const raw = accKeyField.value;
        const extracted = extractTokenFromRawInput(raw, provider);
        if (extracted && extracted !== raw) {
          accKeyField.value = extracted;
          const statusEl = document.getElementById("acc-cookie-status");
          if (statusEl) {
            statusEl.style.display = "block";
            statusEl.className = "acc-cookie-status success";
            statusEl.textContent = "✓ Cookie extraída y limpiada automáticamente.";
          }
        }
      }, 50);
    });
  }

  const btnDetectSession = document.getElementById("btn-detect-session");
  if (btnDetectSession) {
    btnDetectSession.addEventListener("click", async () => {
      const provider = document.getElementById("acc-provider")?.value || "claude";
      const statusEl = document.getElementById("acc-detect-status");
      if (statusEl) {
        statusEl.className = "acc-detect-status loading";
        statusEl.textContent = "Buscando sesión local en el sistema...";
      }
      try {
        const res = await fetch(`/api/auth/detect-session?provider=${encodeURIComponent(provider)}`);
        const data = await res.json();
        if (data.ok && data.found && data.token) {
          const keyInput = document.getElementById("acc-key");
          if (keyInput) {
            keyInput.value = data.token;
            keyInput.type = "text";
            setTimeout(() => {
              if (keyInput) keyInput.type = "password";
            }, 3500);
          }
          const nameInput = document.getElementById("acc-name");
          if (nameInput && !nameInput.value.trim()) {
            nameInput.value = `${data.provider.toUpperCase()} (${data.source || "Sesión Web"})`;
          }
          if (statusEl) {
            statusEl.className = "acc-detect-status success";
            statusEl.textContent = `✓ Detectada: ${data.source || "sesión local"}`;
          }
        } else {
          if (statusEl) {
            statusEl.className = "acc-detect-status warn";
            statusEl.textContent = data.message || "No se detectó sesión local activa.";
          }
        }
      } catch (err) {
        if (statusEl) {
          statusEl.className = "acc-detect-status error";
          statusEl.textContent = "Error al verificar sesión local.";
        }
      }
    });
  }

  if (btnAddAccount) {
    btnAddAccount.addEventListener("click", () => openAccountModal(null));
  }
  if (btnAccountModalClose) {
    btnAccountModalClose.addEventListener("click", closeAccountModal);
  }
  if (btnAccountCancel) {
    btnAccountCancel.addEventListener("click", closeAccountModal);
  }
  if (btnAccountSave) {
    btnAccountSave.addEventListener("click", () => {
      const authType = document.getElementById("acc-auth-type")?.value || "apiKey";
      const authKind = authType === "web" ? "session" : "apiKey";
      const provider = document.getElementById("acc-provider").value;
      const provTitle = provider === "openai" ? "ChatGPT" : (provider === "claude" ? "Claude" : (provider === "grok" ? "Grok" : "FCC"));
      const defaultName = authType === "web" ? `${provTitle} (Web)` : `${provTitle} (API)`;
      const name = document.getElementById("acc-name").value.trim() || defaultName;
      const apiKey = document.getElementById("acc-key").value.trim();
      const baseUrl = document.getElementById("acc-base").value.trim();
      const model = document.getElementById("acc-model").value.trim();
      const enabled = document.getElementById("acc-enabled").checked;

      if (!apiKey) {
        alert(authType === "web"
          ? "Por favor introduce un token de sesión web o pulsa 'Detectar sesión local'."
          : "Por favor introduce una API Key válida para esta cuenta.");
        return;
      }

      if (editingAccountId) {
        const idx = currentAccounts.findIndex((a) => a.id === editingAccountId);
        if (idx !== -1) {
          currentAccounts[idx] = {
            ...currentAccounts[idx],
            provider,
            name,
            apiKey,
            authType,
            authKind,
            baseUrl: baseUrl || undefined,
            model: model || undefined,
            enabled,
          };
        }
      } else {
        currentAccounts.push({
          id: "acc_" + Math.random().toString(36).slice(2, 9),
          provider,
          name,
          apiKey,
          authType,
          authKind,
          baseUrl: baseUrl || undefined,
          model: model || undefined,
          enabled,
        });
      }
      renderAccountsList();
      closeAccountModal();
    });
  }

  function populateSettingsModelSelects(cat = catalog) {
    const providers = ["claude", "grok", "openai", "fcc"];
    providers.forEach((p) => {
      const sel = document.getElementById(`select-${p}-model`);
      const inp = document.getElementById(`set-${p}-model`);
      const badge = document.getElementById(`badge-${p}-models`);
      if (!sel || !inp) return;

      const all = Array.isArray(cat[p]) ? [...cat[p]] : [];
      const list = all.filter((m) => !disabledModels.includes(m));
      if (badge) {
        badge.textContent = `${list.length}/${all.length} activos`;
      }

      const currentVal = (inp.value || "").trim();
      sel.innerHTML = "";

      list.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        sel.appendChild(opt);
      });

      if (currentVal && !list.includes(currentVal)) {
        const customOpt = document.createElement("option");
        customOpt.value = currentVal;
        customOpt.textContent = `${currentVal} (personalizado)`;
        sel.prepend(customOpt);
      }

      const customChoice = document.createElement("option");
      customChoice.value = "__custom__";
      customChoice.textContent = "✏️ Escribir modelo personalizado...";
      sel.appendChild(customChoice);

      if (currentVal && (list.includes(currentVal) || sel.querySelector(`option[value="${currentVal}"]`))) {
        sel.value = currentVal;
      } else if (list.length > 0) {
        sel.value = list[0];
        inp.value = list[0];
      } else if (!currentVal) {
        const emptyChoice = document.createElement("option");
        emptyChoice.value = "";
        emptyChoice.textContent = "(Ningún modelo habilitado)";
        emptyChoice.disabled = true;
        sel.appendChild(emptyChoice);
        sel.value = "";
      }

      sel.onchange = () => {
        if (sel.value === "__custom__") {
          inp.style.display = "block";
          sel.style.display = "none";
          inp.focus();
        } else {
          inp.value = sel.value;
        }
      };
    });
  }

  function renderModelTogglesList(cat = catalog) {
    const providers = ["claude", "grok", "openai", "fcc"];
    providers.forEach((p) => {
      const container = document.getElementById(`list-models-${p}`);
      const stats = document.getElementById(`stats-${p}-models`);
      if (!container) return;

      const all = Array.isArray(cat[p]) ? [...cat[p]] : [];
      const enabled = all.filter((m) => !disabledModels.includes(m));

      if (stats) {
        stats.textContent = `${enabled.length}/${all.length} activos`;
      }

      container.innerHTML = "";
      if (all.length === 0) {
        container.innerHTML = `<div class="models-empty-note">No hay modelos detectados aún. Haz clic en "Refrescar modelos" para identificarlos desde las APIs.</div>`;
        return;
      }

      all.forEach((m) => {
        const isEnabled = !disabledModels.includes(m);
        const row = document.createElement("div");
        row.className = "model-toggle-row" + (isEnabled ? "" : " disabled");

        const label = document.createElement("label");
        label.className = "model-toggle-label";

        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.className = "model-toggle-input";
        chk.checked = isEnabled;
        chk.dataset.provider = p;
        chk.dataset.model = m;

        const nameSpan = document.createElement("span");
        nameSpan.className = "model-toggle-name";
        nameSpan.textContent = m;
        nameSpan.title = m;

        label.appendChild(chk);
        label.appendChild(nameSpan);

        const chip = document.createElement("span");
        chip.className = "model-status-chip " + (isEnabled ? "enabled" : "disabled");
        chip.textContent = isEnabled ? "Habilitado" : "Deshabilitado";

        chk.onchange = () => {
          if (chk.checked) {
            disabledModels = disabledModels.filter((x) => x !== m);
            row.classList.remove("disabled");
            chip.className = "model-status-chip enabled";
            chip.textContent = "Habilitado";
          } else {
            if (!disabledModels.includes(m)) disabledModels.push(m);
            row.classList.add("disabled");
            chip.className = "model-status-chip disabled";
            chip.textContent = "Deshabilitado";
          }
          const currentEnabled = all.filter((x) => !disabledModels.includes(x));
          if (stats) stats.textContent = `${currentEnabled.length}/${all.length} activos`;
          populateSettingsModelSelects(catalog);
          fillModels();
        };

        row.appendChild(label);
        row.appendChild(chip);
        container.appendChild(row);
      });
    });
  }

  async function refreshModels(targetProvider = "all", triggeringBtn = null) {
    const spinner = triggeringBtn ? triggeringBtn.querySelector(".refresh-spinner-svg") : null;
    const allSpinner = document.querySelector("#btn-refresh-all-models .refresh-spinner-svg");
    const compSpinner = document.querySelector("#btn-refresh-composer-models .refresh-spinner-svg");

    if (spinner) spinner.classList.add("spinning");
    if (allSpinner) allSpinner.classList.add("spinning");
    if (compSpinner) compSpinner.classList.add("spinning");

    const feedback = document.getElementById("models-refresh-feedback");
    if (feedback) {
      feedback.style.display = "flex";
      feedback.innerHTML = `<span class="refresh-chip">⟳ Detectando modelos disponibles en las APIs...</span>`;
    }

    try {
      const payload = {
        provider: targetProvider,
        claude: {
          apiKey: (document.getElementById("set-claude-key")?.value || "").trim() || undefined,
        },
        grok: {
          apiKey: (document.getElementById("set-grok-key")?.value || "").trim() || undefined,
        },
        openai: {
          apiKey: (document.getElementById("set-openai-key")?.value || "").trim() || undefined,
          baseUrl: (document.getElementById("set-openai-base")?.value || "").trim() || undefined,
        },
        fcc: {
          baseUrl: (document.getElementById("set-fcc-base")?.value || "").trim() || undefined,
        },
      };

      const res = await fetch("/api/models/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data && data.catalog) {
        catalog = data.catalog;
        populateSettingsModelSelects(catalog);
        renderModelTogglesList(catalog);
        fillModels();

        if (feedback && data.statuses) {
          feedback.innerHTML = "";
          for (const [p, st] of Object.entries(data.statuses)) {
            const chip = document.createElement("span");
            chip.className = "refresh-chip " + (st.ok ? "ok" : "warn");
            const label = p.toUpperCase();
            if (st.ok) {
              chip.innerHTML = `✓ ${label}: ${st.count} modelos detectados`;
            } else {
              chip.innerHTML = `ℹ ${label}: ${st.count} modelos (${st.error || "catálogo"})`;
            }
            feedback.appendChild(chip);
          }
        }
      }
    } catch (err) {
      if (feedback) {
        feedback.innerHTML = `<span class="refresh-chip warn">⚠ Error al conectar con las APIs: ${err.message}</span>`;
      }
    } finally {
      if (spinner) spinner.classList.remove("spinning");
      if (allSpinner) allSpinner.classList.remove("spinning");
      if (compSpinner) compSpinner.classList.remove("spinning");
    }
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
    disabledModels = Array.isArray(res["fhIa.disabledModels"]) ? [...res["fhIa.disabledModels"]] : [];
    disabledProviders = Array.isArray(res["fhIa.disabledProviders"]) ? [...res["fhIa.disabledProviders"]] : [];
    ALL_PROVIDERS.forEach(({ id }) => {
      if (res[`fhIa.${id}.enabled`] === false && !disabledProviders.includes(id)) {
        disabledProviders.push(id);
      }
    });
    currentAccounts = Array.isArray(res["fhIa.accounts"]) ? [...res["fhIa.accounts"]] : [];
    renderAccountsList();
    renderProviderMasterToggles();
    populateSettingsModelSelects(catalog);
    renderModelTogglesList(catalog);
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
      "fhIa.accounts": currentAccounts,
      "fhIa.disabledModels": disabledModels,
      "fhIa.disabledProviders": disabledProviders,
      "fhIa.claude.enabled": !disabledProviders.includes("claude"),
      "fhIa.grok.enabled": !disabledProviders.includes("grok"),
      "fhIa.openai.enabled": !disabledProviders.includes("openai"),
      "fhIa.fcc.enabled": !disabledProviders.includes("fcc"),
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
      disabledModels = [];
      disabledProviders = [];
      currentAccounts = [];
      renderAccountsList();
      renderProviderMasterToggles();
      populateSettingsModelSelects(catalog);
      renderModelTogglesList(catalog);
      fillProviders();
      fillModels();
      settingsModal.style.display = "none";
      alert("Ajustes restablecidos correctamente.");
    }
  }

  // Sidebar Tab Switcher & Toggle
  function showSidebarTab(tab) {
    explorerVisible = true;
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
    applyShellLayout();
    if (editor) editor.layout();
  }

  function toggleSidebarTab(tab) {
    if (tab === "files") {
      if (actFiles.classList.contains("active") && explorerVisible) {
        explorerVisible = false;
        actFiles.classList.remove("active");
        applyShellLayout();
        if (editor) editor.layout();
        return;
      }
      showSidebarTab("files");
    } else if (tab === "search") {
      if (actSearch.classList.contains("active") && explorerVisible) {
        explorerVisible = false;
        actSearch.classList.remove("active");
        applyShellLayout();
        if (editor) editor.layout();
        return;
      }
      showSidebarTab("search");
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

  /* ==========================================================================
     AI Usage & Rate Limits Summary Bar Manager
     ========================================================================== */
  const AI_LIMITS_KEY = "fhIa.providerLimits";

  const defaultProviderLimits = {
    claude: { usedPercent: null, remaining: null, limit: null, kind: "tokens", totalTokens: 0, status: "ready" },
    openai: { usedPercent: null, remaining: null, limit: null, kind: "tokens", totalTokens: 0, status: "ready" },
    grok: { usedPercent: null, remaining: null, limit: null, kind: "tokens", totalTokens: 0, status: "ready" },
    fcc: { unlimited: true, totalTokens: 0, status: "unlimited" },
  };

  function getAiLimits() {
    try {
      const raw = localStorage.getItem(AI_LIMITS_KEY);
      if (raw) return { ...defaultProviderLimits, ...JSON.parse(raw) };
    } catch {}
    return { ...defaultProviderLimits };
  }

  function saveAiLimits(data) {
    try {
      localStorage.setItem(AI_LIMITS_KEY, JSON.stringify(data));
    } catch {}
  }

  function formatTokenCount(num) {
    if (num == null) return "0";
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "k";
    return String(num);
  }

  function updateAiLimitsUI(targetProvider, rateLimit, usage) {
    const limits = getAiLimits();
    if (targetProvider && limits[targetProvider]) {
      const p = limits[targetProvider];
      if (rateLimit) {
        if (rateLimit.usedPercent != null) p.usedPercent = Math.max(0, Math.min(100, Math.round(rateLimit.usedPercent)));
        if (rateLimit.remaining != null) p.remaining = rateLimit.remaining;
        if (rateLimit.limit != null) p.limit = rateLimit.limit;
        if (rateLimit.kind != null) p.kind = rateLimit.kind;
      }
      if (usage && (usage.totalTokens || usage.completionTokens)) {
        p.totalTokens = (p.totalTokens || 0) + (usage.totalTokens || usage.completionTokens || 0);
      }
      p.lastUpdated = Date.now();
      saveAiLimits(limits);
    }
    renderAiLimitsBar(limits);
  }

  function renderAiLimitsBar(limits) {
    const data = limits || getAiLimits();
    const currentProv = providerEl ? providerEl.value : "claude";

    const provs = ["claude", "openai", "grok", "fcc"];
    provs.forEach((pid) => {
      const p = data[pid] || {};
      const pill = document.getElementById(`status-pill-${pid}`);
      const valEl = document.getElementById(`sb-pct-${pid}`);
      const fillEl = document.getElementById(`sb-fill-${pid}`);

      if (!pill || !valEl || !fillEl) return;

      if (pid === currentProv) {
        pill.classList.add("selected");
      } else {
        pill.classList.remove("selected");
      }

      if (pid === "fcc" || p.unlimited) {
        valEl.textContent = "∞";
        valEl.className = "status-usage-pct is-unlimited";
        fillEl.className = "status-usage-fill is-unlimited";
        fillEl.style.width = "100%";
        pill.title = `FCC Local (Servidor propio)\n• Cuota ilimitada sin coste ni API Key\n• Tokens en esta sesión: ${formatTokenCount(p.totalTokens || 0)}\n(Haz clic para seleccionar esta IA)`;
        return;
      }

      let usedPct = p.usedPercent;
      let dispPct = usedPct != null ? Math.max(0, 100 - usedPct) : 100;

      let statusClass = "";
      if (usedPct != null) {
        if (usedPct >= 90) statusClass = "danger";
        else if (usedPct >= 65) statusClass = "warning";
      }

      valEl.className = `status-usage-pct ${statusClass}`.trim();
      fillEl.className = `status-usage-fill ${statusClass}`.trim();

      if (usedPct != null) {
        valEl.textContent = `${dispPct}%`;
        fillEl.style.width = `${Math.min(100, Math.max(4, usedPct))}%`;
      } else {
        valEl.textContent = p.totalTokens > 0 ? `${formatTokenCount(p.totalTokens)}` : "100%";
        fillEl.style.width = p.totalTokens > 0 ? "10%" : "0%";
      }

      const provName = pid === "openai" ? "ChatGPT / OpenAI" : (pid === "claude" ? "Claude (Anthropic)" : "Grok (xAI)");
      let tooltip = `${provName}:\n`;
      if (usedPct != null) {
        tooltip += `• Disponibilidad: ${dispPct}% restante (${usedPct}% consumido)\n`;
      } else {
        tooltip += `• Estado: Disponible para consultas\n`;
      }
      if (p.remaining != null && p.limit != null) {
        tooltip += `• Cuota: ${formatTokenCount(p.remaining)} / ${formatTokenCount(p.limit)} ${p.kind || "tokens"}\n`;
      }
      tooltip += `• Tokens usados en sesión: ${formatTokenCount(p.totalTokens || 0)}\n(Haz clic para seleccionar esta IA)`;
      pill.title = tooltip;
    });

    const activeAiText = document.getElementById("sb-active-ai-text");
    if (activeAiText) {
      const provNamesShort = { claude: "Claude", openai: "ChatGPT", grok: "Grok", fcc: "FCC" };
      const curName = provNamesShort[currentProv] || currentProv;
      const curModel = modelEl && modelEl.value ? modelEl.value : "";
      activeAiText.textContent = curModel ? `${curName} (${curModel})` : curName;
    }

    renderLimitsPopoverGrid(data);
  }

  function renderLimitsPopoverGrid(data) {
    const list = document.getElementById("usage-popover-list");
    if (!list) return;
    list.innerHTML = "";

    const provNames = {
      claude: "Claude (Anthropic)",
      openai: "ChatGPT / OpenAI",
      grok: "Grok (xAI)",
      fcc: "FCC Local (Servidor propio)",
    };

    const provDots = {
      claude: "dot-claude",
      openai: "dot-openai",
      grok: "dot-grok",
      fcc: "dot-fcc",
    };

    ["claude", "openai", "grok", "fcc"].forEach((pid) => {
      const p = data[pid] || {};
      const card = document.createElement("div");
      card.className = "usage-popover-card";

      const dispPct = p.usedPercent != null ? Math.max(0, 100 - p.usedPercent) : 100;
      const isUnl = pid === "fcc" || p.unlimited;

      let badgeText = "ACTIVO";
      if (isUnl) badgeText = "ILIMITADO";
      else if (p.usedPercent != null) badgeText = `${dispPct}% disponible`;

      card.innerHTML = `
        <div class="usage-popover-card-head">
          <span class="usage-popover-card-title">
            <span class="status-provider-dot ${provDots[pid]}"></span>
            <strong>${provNames[pid]}</strong>
          </span>
          <span class="usage-popover-card-badge">${badgeText}</span>
        </div>
        <div class="usage-popover-card-grid">
          <div><strong>Tokens sesión:</strong> ${formatTokenCount(p.totalTokens || 0)}</div>
          <div><strong>Límite:</strong> ${isUnl ? "Sin restricción" : (p.limit != null ? `${formatTokenCount(p.limit)} ${p.kind || "tok"}` : "Dinámico")}</div>
          <div><strong>Restante:</strong> ${isUnl ? "∞" : (p.remaining != null ? formatTokenCount(p.remaining) : "Cuota estándar")}</div>
          <div><strong>Consumo:</strong> ${isUnl ? "0%" : (p.usedPercent != null ? `${p.usedPercent}%` : "< 1%")}</div>
        </div>
      `;
      list.appendChild(card);
    });
  }

  function setupAiLimitsBar() {
    const pillsContainer = document.getElementById("statusbar-roster-pills");
    if (pillsContainer) {
      pillsContainer.addEventListener("click", (e) => {
        const pill = e.target.closest(".status-provider-pill");
        if (!pill) return;
        e.stopPropagation();
        const pid = pill.getAttribute("data-provider");
        if (pid && providerEl && providerEl.value !== pid) {
          providerEl.value = pid;
          fillModels();
          renderAiLimitsBar();
        }
      });
    }

    const btnUsage = document.getElementById("btn-statusbar-usage");
    const popover = document.getElementById("statusbar-usage-popover");
    const btnClosePopover = document.getElementById("btn-close-sb-popover");
    const btnResetCounters = document.getElementById("btn-sb-reset-counters");
    const btnOpenSettings = document.getElementById("btn-sb-open-settings");
    const btnRefresh = document.getElementById("btn-statusbar-refresh");

    if (btnUsage && popover) {
      btnUsage.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = popover.style.display !== "none";
        popover.style.display = isOpen ? "none" : "flex";
        if (!isOpen) renderAiLimitsBar();
      });
    }

    if (btnClosePopover && popover) {
      btnClosePopover.addEventListener("click", (e) => {
        e.stopPropagation();
        popover.style.display = "none";
      });
    }

    if (btnResetCounters) {
      btnResetCounters.addEventListener("click", (e) => {
        e.stopPropagation();
        const limits = getAiLimits();
        Object.keys(limits).forEach((k) => {
          limits[k].totalTokens = 0;
          limits[k].usedPercent = null;
          limits[k].remaining = null;
        });
        saveAiLimits(limits);
        renderAiLimitsBar(limits);
      });
    }

    if (btnOpenSettings) {
      btnOpenSettings.addEventListener("click", (e) => {
        e.stopPropagation();
        if (popover) popover.style.display = "none";
        if (typeof showSettingsModal === "function") showSettingsModal();
      });
    }

    if (btnRefresh) {
      btnRefresh.addEventListener("click", async (e) => {
        e.stopPropagation();
        btnRefresh.classList.add("spinning");
        try {
          const res = await fetch("/api/providers/limits");
          const data = await res.json();
          if (data.ok && data.limits) {
            const current = getAiLimits();
            Object.keys(data.limits).forEach((k) => {
              if (data.limits[k] && data.limits[k].usedPercent != null) {
                current[k] = { ...current[k], ...data.limits[k] };
              }
            });
            saveAiLimits(current);
            renderAiLimitsBar(current);
          }
        } catch (_) {}
        setTimeout(() => btnRefresh.classList.remove("spinning"), 500);
      });
    }

    // Status bar right items
    const sbGitBranch = document.getElementById("sb-git-branch");
    if (sbGitBranch) {
      sbGitBranch.addEventListener("click", () => {
        if (typeof openBottomPanel === "function") openBottomPanel("git");
      });
    }

    const sbToggleTerminal = document.getElementById("sb-toggle-terminal");
    if (sbToggleTerminal) {
      sbToggleTerminal.addEventListener("click", () => {
        if (typeof toggleTerminalPanel === "function") toggleTerminalPanel();
      });
    }

    const sbActiveAi = document.getElementById("sb-active-ai");
    if (sbActiveAi) {
      sbActiveAi.addEventListener("click", () => {
        if (popover) {
          const isOpen = popover.style.display !== "none";
          popover.style.display = isOpen ? "none" : "flex";
          if (!isOpen) renderAiLimitsBar();
        }
      });
    }

    document.addEventListener("click", (e) => {
      if (popover && popover.style.display !== "none") {
        if (!popover.contains(e.target) && e.target !== btnUsage && !btnUsage?.contains(e.target) && e.target !== sbActiveAi && !sbActiveAi?.contains(e.target)) {
          popover.style.display = "none";
        }
      }
    });

    fetch("/api/providers/limits")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.limits) {
          const current = getAiLimits();
          Object.keys(data.limits).forEach((k) => {
            if (data.limits[k] && data.limits[k].usedPercent != null) {
              current[k] = { ...current[k], ...data.limits[k] };
            }
          });
          saveAiLimits(current);
          renderAiLimitsBar(current);
        }
      })
      .catch(() => {});

    renderAiLimitsBar();
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
          else if (msg.type === "meta") {
            if (typeof updateAiLimitsUI === "function") {
              updateAiLimitsUI(providerEl.value, msg.rateLimit, msg.usage);
            }
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
            if (typeof updateAiLimitsUI === "function") {
              updateAiLimitsUI(msg.provider || providerEl.value, msg.rateLimit, msg.usage);
            }

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
  if (modelEl) modelEl.addEventListener("change", () => renderAiLimitsBar());
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
  const btnChatOpenSettings = document.getElementById("btn-chat-open-settings");
  if (btnChatOpenSettings) btnChatOpenSettings.addEventListener("click", showSettingsModal);
  btnRefreshTree.addEventListener("click", () => { loadTree(".", treeEl); scanAllFiles(); });

  // Activity Bar
  actFiles.addEventListener("click", () => toggleSidebarTab("files"));
  actSearch.addEventListener("click", () => toggleSidebarTab("search"));
  actGit.addEventListener("click", () => openBottomPanel("git"));
  actTerminal.addEventListener("click", () => openBottomPanel("terminal"));
  actSettings.addEventListener("click", showSettingsModal);
  if (actChat) {
    actChat.addEventListener("click", () => {
      if (typeof openChatInDocument === "function") {
        openChatInDocument(currentChatId || (chatThreads[0] && chatThreads[0].id));
      }
      inputEl.focus();
    });
  }

  // Mobile Bottom Navigation Bar
  const mobileNavBtns = document.querySelectorAll(".mobile-nav-btn");
  mobileNavBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      mobileNavBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.view;
      if (view === "files") {
        showSidebarTab("files");
      } else if (view === "editor") {
        if (isClaudeMode) toggleClaudeMode();
        if (chatDocView) chatDocView.style.display = "none";
        if (editorEl) editorEl.style.display = "block";
        if (editor) editor.layout();
      } else if (view === "chat") {
        if (typeof openChatInDocument === "function") {
          openChatInDocument(currentChatId || (chatThreads[0] && chatThreads[0].id));
        }
      } else if (view === "history") {
        if (chatSearchInput) chatSearchInput.focus();
      } else if (view === "settings") {
        showSettingsModal();
      }
    });
  });

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

  // Automatic Model Refresh & Discovery buttons
  const btnRefreshAllModels = document.getElementById("btn-refresh-all-models");
  if (btnRefreshAllModels) {
    btnRefreshAllModels.addEventListener("click", () => refreshModels("all", btnRefreshAllModels));
  }

  const btnRefreshComposerModels = document.getElementById("btn-refresh-composer-models");
  if (btnRefreshComposerModels) {
    btnRefreshComposerModels.addEventListener("click", () => refreshModels(providerEl.value, btnRefreshComposerModels));
  }

  document.querySelectorAll(".btn-refresh-single").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = btn.getAttribute("data-provider");
      if (p) refreshModels(p, btn);
    });
  });

  document.querySelectorAll(".btn-toggle-custom-model").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = btn.getAttribute("data-target");
      const sel = document.getElementById(`select-${p}-model`);
      const inp = document.getElementById(`set-${p}-model`);
      if (sel && inp) {
        if (inp.style.display === "none") {
          inp.style.display = "block";
          sel.style.display = "none";
          inp.focus();
        } else {
          inp.style.display = "none";
          sel.style.display = "block";
          if (sel.value && sel.value !== "__custom__") {
            inp.value = sel.value;
          }
        }
      }
    });
  });

  // Provider Model Drawer Expand/Collapse
  document.querySelectorAll(".btn-drawer-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = btn.getAttribute("data-provider");
      const drawer = document.getElementById(`list-models-${p}`);
      if (drawer) {
        const isOpen = drawer.style.display !== "none";
        drawer.style.display = isOpen ? "none" : "grid";
        btn.classList.toggle("expanded", !isOpen);
      }
    });
  });

  // Provider Model Bulk Actions (Enable All / Disable All)
  document.querySelectorAll(".btn-bulk-action").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const p = btn.getAttribute("data-provider");
      const action = btn.getAttribute("data-action");
      const all = Array.isArray(catalog[p]) ? [...catalog[p]] : [];
      if (action === "all") {
        disabledModels = disabledModels.filter((m) => !all.includes(m));
      } else if (action === "none") {
        all.forEach((m) => {
          if (!disabledModels.includes(m)) disabledModels.push(m);
        });
      }
      renderModelTogglesList(catalog);
      populateSettingsModelSelects(catalog);
      fillModels();
    });
  });

  // Setup Provider Master Toggles
  setupProviderMasterToggles();

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
          <span class="inline-edit-title"><svg class="cursor-sparkle" viewBox="0 0 16 16" width="14" height="14" fill="var(--accent)" style="margin-right: 6px; vertical-align: -2px;"><path d="M8 0C8 4.418 4.418 8 0 8C4.418 8 8 11.582 8 16C8 11.582 11.582 8 16 8C11.582 8 8 4.418 8 0Z"/></svg>Cursor Inline Edit (Ctrl+K)</span>
          <span class="inline-edit-hint">Enter para generar · Esc para cerrar</span>
        </div>
        <div class="inline-edit-body">
          <input type="text" id="inline-edit-input" class="inline-edit-input" placeholder="Instrucción (ej: 'añadir validación', 'convertir a async')..." />
          <button id="inline-edit-btn" class="inline-edit-submit">Generar</button>
        </div>
        <div id="inline-edit-actions" class="inline-edit-actions" style="display:none;">
          <span class="inline-edit-status">Cambios aplicados inline:</span>
          <button id="inline-edit-accept" class="btn-action-accept"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: -1px;"><polyline points="3 8.5 6.5 12 13 4"></polyline></svg>Aceptar (Ctrl+Enter)</button>
          <button id="inline-edit-reject" class="btn-action-reject"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: -1px;"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>Descartar (Esc)</button>
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
            <span class="composer-title"><svg class="cursor-sparkle" viewBox="0 0 16 16" width="14" height="14" fill="var(--accent)" style="margin-right: 6px; vertical-align: -2px;"><path d="M8 0C8 4.418 4.418 8 0 8C4.418 8 8 11.582 8 16C8 11.582 11.582 8 16 8C11.582 8 8 4.418 8 0Z"/></svg>Cursor Composer (Ctrl+I)</span>
            <div style="display:flex; gap:8px; align-items:center;">
              <button id="composer-btn-rollback" class="composer-rollback-btn" title="Revertir cambios al checkpoint anterior"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: -1px;"><path d="M14 8H3M7 4L3 8l4 4"/></svg>Rollback</button>
              <button id="composer-btn-close" style="background:none; border:none; color:#94a3b8; cursor:pointer; display:flex; align-items:center;"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg></button>
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
  setupAiLimitsBar();
})();
