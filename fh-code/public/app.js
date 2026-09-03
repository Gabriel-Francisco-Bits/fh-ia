/* fh-code — Monaco (VS Code engine) + fh-ia chat */
(function () {
  const treeEl = document.getElementById("tree");
  const tabsEl = document.getElementById("tabs");
  const messagesEl = document.getElementById("messages");
  const inputEl = document.getElementById("input");
  const providerEl = document.getElementById("provider");
  const modelEl = document.getElementById("model");
  const modeEl = document.getElementById("mode");
  const wsName = document.getElementById("ws-name");

  const openTabs = [];
  let activePath = "";
  let editor = null;
  let catalog = {};
  let streaming = false;

  function langOf(p) {
    const ext = (p.split(".").pop() || "").toLowerCase();
    const map = {
      ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
      json: "json", md: "markdown", css: "css", html: "html", py: "python",
      rs: "rust", go: "go", sh: "shell", yml: "yaml", yaml: "yaml", svg: "xml",
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
    catalog = meta.models || {};
    providerEl.value = meta.provider || "grok";
    fillModels();
    await loadTree(".", treeEl);
  }

  async function loadTree(dir, into) {
    const data = await (await fetch("/api/tree?dir=" + encodeURIComponent(dir))).json();
    into.innerHTML = "";
    for (const ent of data.entries || []) {
      const btn = document.createElement("button");
      btn.textContent = (ent.dir ? "▸ " : "") + ent.name;
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

  function renderTabs() {
    tabsEl.innerHTML = "";
    openTabs.forEach((t) => {
      const b = document.createElement("button");
      b.className = "tab" + (t.path === activePath ? " active" : "");
      b.textContent = t.path.split("/").pop();
      b.addEventListener("click", () => openFile(t.path));
      tabsEl.appendChild(b);
    });
  }

  async function openFile(p) {
    let tab = openTabs.find((t) => t.path === p);
    if (!tab) {
      const data = await (await fetch("/api/file?path=" + encodeURIComponent(p))).json();
      tab = { path: p, content: data.content };
      openTabs.push(tab);
    }
    activePath = p;
    renderTabs();
    if (editor) {
      const model = monaco.editor.createModel(tab.content, langOf(p));
      editor.setModel(model);
      editor.updateOptions({ theme: "vs-dark" });
    }
    document.querySelectorAll(".tree .file").forEach((el) => {
      el.classList.toggle("active", el.textContent === p.split("/").pop());
    });
  }

  async function save() {
    if (!editor || !activePath) return;
    const content = editor.getValue();
    const tab = openTabs.find((t) => t.path === activePath);
    if (tab) tab.content = content;
    await fetch("/api/file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: activePath, content }),
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

  async function send() {
    const text = String(inputEl.value || "").trim();
    if (!text || streaming) return;
    inputEl.value = "";
    append("user", text);
    const node = append("assistant", "");
    streaming = true;
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "main",
        text,
        provider: providerEl.value,
        model: modelEl.value,
        mode: modeEl.value,
        activePath,
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
        if (msg.type === "delta") node.textContent += msg.text || "";
        else if (msg.type === "status") append("system", msg.text || "");
        else if (msg.type === "error") append("error", msg.message || "Error");
        else if (msg.type === "done") {
          if (msg.text) node.textContent = msg.text;
          (msg.edits || []).forEach((edit) => {
            const wrap = append("system", "Edición: " + edit.path);
            const ok = document.createElement("button");
            ok.textContent = "Accept";
            ok.addEventListener("click", async () => {
              await fetch("/api/edit/accept", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ edit }),
              });
              wrap.textContent = "Aplicado " + edit.path;
              if (activePath === edit.path) openFile(edit.path);
            });
            wrap.appendChild(ok);
          });
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    }
    streaming = false;
  }

  providerEl.addEventListener("change", fillModels);
  document.getElementById("send").addEventListener("click", send);
  inputEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      send();
    }
  });
  window.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "s") {
      ev.preventDefault();
      save();
    }
  });

  require.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs" } });
  require(["vs/editor/editor.main"], () => {
    editor = monaco.editor.create(document.getElementById("editor"), {
      value: "// Abre un archivo del explorador\n",
      language: "typescript",
      theme: "vs-dark",
      automaticLayout: true,
      fontSize: 15,
      minimap: { enabled: true },
      smoothScrolling: true,
    });
    loadMeta();
  });
})();
