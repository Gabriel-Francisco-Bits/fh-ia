/* fh-ia webview — browser-only, no Node require/module. */
(function (global) {
  "use strict";

  var vscodeApi = null;
  try {
    if (typeof acquireVsCodeApi === "function") {
      vscodeApi = acquireVsCodeApi();
    }
  } catch (_e) {
    vscodeApi = null;
  }

  var state = {
    provider: "grok",
    model: "grok-4",
    mode: "ask",
    streaming: false,
    models: [],
    catalog: {},
    config: null,
    settingsOpen: false,
    fccEnabled: true,
    fccOk: false,
  };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "className") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c) node.appendChild(c);
    });
    return node;
  }

  function post(msg) {
    if (vscodeApi && vscodeApi.postMessage) {
      vscodeApi.postMessage(msg);
    }
  }

  function uniqueList(values) {
    var out = [];
    (values || []).forEach(function (v) {
      if (v && out.indexOf(v) < 0) out.push(v);
    });
    return out;
  }

  function fillSelect(select, values, current) {
    var list = uniqueList(values);
    select.innerHTML = "";
    list.forEach(function (v) {
      var opt = el("option", { value: v, text: v });
      select.appendChild(opt);
    });
    if (current && list.indexOf(current) < 0) {
      select.insertBefore(el("option", { value: current, text: current }), select.firstChild);
      list.unshift(current);
    }
    if (current && list.indexOf(current) >= 0) select.value = current;
    else if (list.length) select.value = list[0];
  }

  function mount(root) {
    if (!root) return;

    root.innerHTML = "";
    root.className = "mia-root";

    var newBtn = el("button", { className: "mia-icon-btn", title: "Nuevo chat", type: "button", text: "+" });
    var title = el("h1", { text: "fh-ia" });
    var authLabel = el("span", { id: "mia-auth", className: "mia-auth", text: "" });
    var gearBtn = el("button", { className: "mia-icon-btn", title: "Ajustes", type: "button", text: "⚙" });

    var providerSelect = el("select", { id: "mia-provider", title: "IA" });
    var modelSelect = el("select", { id: "mia-model", title: "Modelo" });
    var modeSelect = el("select", { id: "mia-mode", title: "Modo" }, [
      el("option", { value: "ask", text: "Preguntar" }),
      el("option", { value: "plan", text: "Plan" }),
      el("option", { value: "autonomous", text: "Autónomo" }),
    ]);

    providerSelect.value = state.provider;
    modeSelect.value = state.mode;

    var header = el("div", { className: "mia-header" }, [
      newBtn,
      title,
      authLabel,
      gearBtn,
    ]);
    var toolbar = el("div", { className: "mia-toolbar" }, [
      el("label", { className: "mia-field" }, [el("span", { text: "IA" }), providerSelect]),
      el("label", { className: "mia-field mia-field-grow" }, [el("span", { text: "Modelo" }), modelSelect]),
      el("label", { className: "mia-field" }, [el("span", { text: "Modo" }), modeSelect]),
    ]);

    var messages = el("div", { className: "mia-messages", id: "mia-messages" });
    var hint = el("div", {
      className: "mia-hint",
      text: "La carpeta abierta y el árbol del repo se envían solos. + chat nuevo. Preguntar / Plan / Autónomo. @archivo adjunta ficheros.",
    });

    var input = el("textarea", {
      id: "mia-input",
      placeholder: "Pregunta a Claude, Grok, FCC u otra IA…",
    });
    var sendBtn = el("button", { id: "mia-send", text: "Enviar" });
    var composer = el("div", { className: "mia-composer" }, [input, sendBtn]);

    var settings = el("div", { className: "mia-settings" });

    root.appendChild(header);
    root.appendChild(toolbar);
    root.appendChild(messages);
    root.appendChild(hint);
    root.appendChild(composer);
    root.appendChild(settings);

    function fillProviders() {
      var current = providerSelect.value || state.provider;
      providerSelect.innerHTML = "";
      [
        ["claude", "Claude"],
        ["grok", "Grok"],
        ["openai", "OpenAI"],
        ["fcc", "FCC"],
      ].forEach(function (pair) {
        providerSelect.appendChild(el("option", { value: pair[0], text: pair[1] }));
      });
      providerSelect.value = current;
      if (providerSelect.value !== current) providerSelect.value = "grok";
      state.provider = providerSelect.value;
    }

    fillProviders();

    function applyAppearance(ui) {
      ui = ui || (state.config && state.config.ui) || {};
      var theme = ui.theme || "auto";
      root.setAttribute("data-theme", theme);
      if (document.documentElement) document.documentElement.setAttribute("data-theme", theme);
      if (document.body) document.body.setAttribute("data-theme", theme);
      root.style.setProperty("--mia-font-size", (ui.fontSize || 16) + "px");
      root.style.setProperty("--mia-icon-size", (ui.iconSize || 18) + "px");
      if (ui.accent) root.style.setProperty("--mia-accent", ui.accent);
      if (ui.userBubble) root.style.setProperty("--mia-user-bg", ui.userBubble);
      if (ui.assistantBubble) root.style.setProperty("--mia-assistant-bg", ui.assistantBubble);
    }

    function setSettingsOpen(open) {
      state.settingsOpen = !!open;
      settings.className = open ? "mia-settings is-open" : "mia-settings";
    }

    function providerBlock(id, label, cfg) {
      cfg = cfg || {};
      return el("fieldset", { className: "mia-set-block" }, [
        el("legend", { text: label }),
        el("label", {}, [
          el("span", { text: "Modelo" }),
          el("input", { type: "text", "data-key": id + ".model", value: cfg.model || "" }),
        ]),
        el("label", {}, [
          el("span", { text: "Base URL" }),
          el("input", { type: "text", "data-key": id + ".baseUrl", value: cfg.baseUrl || "" }),
        ]),
        el("label", {}, [
          el("span", { text: "API key (vacío = no cambiar)" }),
          el("input", { type: "password", "data-key": id + ".apiKey", value: cfg.apiKey || "", placeholder: "••••" }),
        ]),
      ]);
    }

    function renderSettings() {
      var cfg = state.config || {};
      settings.innerHTML = "";
      var authSel = el("select", { "data-key": "authMode" }, [
        el("option", { value: "auto", text: "auto (key, luego CLI)" }),
        el("option", { value: "apiKey", text: "solo API key" }),
        el("option", { value: "terminal", text: "solo sesión terminal" }),
      ]);
      authSel.value = cfg.authMode || "auto";
      var failSel = el("select", { "data-key": "failoverEnabled" }, [
        el("option", { value: "true", text: "sí" }),
        el("option", { value: "false", text: "no" }),
      ]);
      failSel.value = cfg.failover && cfg.failover.enabled === false ? "false" : "true";
      var orderInput = el("input", {
        type: "text",
        "data-key": "failoverOrder",
        value: (cfg.failover && cfg.failover.order && cfg.failover.order.join
          ? cfg.failover.order.join(",")
          : "grok,claude,openai"),
      });
      var modeSel = el("select", { "data-key": "agentMode" }, [
        el("option", { value: "ask", text: "Preguntar" }),
        el("option", { value: "plan", text: "Plan" }),
        el("option", { value: "autonomous", text: "Autónomo" }),
      ]);
      modeSel.value = cfg.agentMode || state.mode;
      var provSel = el("select", { "data-key": "provider" }, [
        el("option", { value: "claude", text: "Claude" }),
        el("option", { value: "grok", text: "Grok" }),
        el("option", { value: "openai", text: "OpenAI" }),
        el("option", { value: "fcc", text: "FCC" }),
      ]);
      provSel.value = cfg.provider || state.provider;
      var fccOn = el("input", { type: "checkbox", "data-key": "fccEnabled" });
      fccOn.checked = cfg.fccEnabled !== false;
      var fccStatus = el("div", {
        className: "mia-hint",
        text: state.fccOk
          ? "FCC en marcha (fcc-server)."
          : "FCC no responde. Instala y arranca: curl -fsSL https://raw.githubusercontent.com/Alishahryar1/free-claude-code/main/scripts/install.sh | sh  →  fcc-server",
      });

      var save = el("button", { text: "Guardar", type: "button" });
      var vscodeBtn = el("button", { text: "Settings de VS Code", type: "button", className: "secondary" });
      var close = el("button", { text: "Cerrar", type: "button", className: "secondary" });

      save.addEventListener("click", function () {
        function nodeFor(key) {
          return settings.querySelector('[data-key="' + key + '"]');
        }
        function val(key) {
          var node = nodeFor(key);
          return node ? node.value : "";
        }
        var fccBox = nodeFor("fccEnabled");
        post({
          type: "saveSettings",
          settings: {
            provider: val("provider"),
            agentMode: val("agentMode"),
            authMode: val("authMode"),
            failoverEnabled: val("failoverEnabled") === "true",
            failoverOrder: val("failoverOrder"),
            fccEnabled: fccBox ? !!fccBox.checked : true,
            theme: val("theme"),
            fontSize: Number(val("fontSize") || 16),
            iconSize: Number(val("iconSize") || 18),
            accent: val("accent"),
            userBubble: val("userBubble"),
            assistantBubble: val("assistantBubble"),
            claude: { model: val("claude.model"), baseUrl: val("claude.baseUrl"), apiKey: val("claude.apiKey") },
            grok: { model: val("grok.model"), baseUrl: val("grok.baseUrl"), apiKey: val("grok.apiKey") },
            openai: { model: val("openai.model"), baseUrl: val("openai.baseUrl"), apiKey: val("openai.apiKey") },
            fcc: { model: val("fcc.model"), baseUrl: val("fcc.baseUrl"), apiKey: val("fcc.apiKey") },
          },
        });
      });
      vscodeBtn.addEventListener("click", function () {
        post({ type: "openVsCodeSettings" });
      });
      close.addEventListener("click", function () {
        setSettingsOpen(false);
      });

      var ui = cfg.ui || {};
      var themeSel = el("select", { "data-key": "theme" }, [
        el("option", { value: "auto", text: "Auto (VS Code)" }),
        el("option", { value: "light", text: "Blanco" }),
        el("option", { value: "dark", text: "Oscuro" }),
      ]);
      themeSel.value = ui.theme || "auto";
      settings.appendChild(el("h2", { text: "Ajustes fh-ia" }));
      settings.appendChild(el("p", { className: "mia-hint", text: "Apariencia suave, modos blanco/oscuro, y tamaños. IA, modelo y modo también se cambian arriba." }));
      settings.appendChild(el("fieldset", { className: "mia-set-block" }, [
        el("legend", { text: "Apariencia" }),
        el("label", {}, [el("span", { text: "Tema" }), themeSel]),
        el("label", {}, [
          el("span", { text: "Tamaño del texto (px)" }),
          el("input", { type: "number", min: "11", max: "22", "data-key": "fontSize", value: String(ui.fontSize || 16) }),
        ]),
        el("label", {}, [
          el("span", { text: "Tamaño de iconos (px)" }),
          el("input", { type: "number", min: "12", max: "28", "data-key": "iconSize", value: String(ui.iconSize || 18) }),
        ]),
        el("label", {}, [
          el("span", { text: "Color de acento" }),
          el("input", { type: "color", "data-key": "accent", value: ui.accent || "#7c8aff" }),
        ]),
        el("label", {}, [
          el("span", { text: "Burbuja usuario" }),
          el("input", { type: "color", "data-key": "userBubble", value: ui.userBubble || "#dce1ff" }),
        ]),
        el("label", {}, [
          el("span", { text: "Burbuja asistente" }),
          el("input", { type: "color", "data-key": "assistantBubble", value: ui.assistantBubble || "#eceae4" }),
        ]),
      ]));
      settings.appendChild(el("label", { className: "mia-check" }, [fccOn, el("span", { text: "FCC (Free Claude Code) como IA" })]));
      settings.appendChild(fccStatus);
      settings.appendChild(el("label", {}, [el("span", { text: "IA por defecto" }), provSel]));
      settings.appendChild(el("label", {}, [el("span", { text: "Modo por defecto" }), modeSel]));
      settings.appendChild(el("label", {}, [el("span", { text: "Autenticación" }), authSel]));
      settings.appendChild(el("label", {}, [el("span", { text: "Failover" }), failSel]));
      settings.appendChild(el("label", {}, [el("span", { text: "Orden failover" }), orderInput]));
      settings.appendChild(providerBlock("claude", "Claude", cfg.claude));
      settings.appendChild(providerBlock("grok", "Grok", cfg.grok));
      settings.appendChild(providerBlock("openai", "OpenAI-compatible", cfg.openai));
      settings.appendChild(providerBlock("fcc", "Free Claude Code (localhost:8082)", cfg.fcc));
      settings.appendChild(el("div", { className: "mia-set-actions" }, [save, vscodeBtn, close]));
    }

    newBtn.addEventListener("click", function () {
      post({ type: "newChat" });
    });
    gearBtn.addEventListener("click", function () {
      if (!state.settingsOpen) renderSettings();
      setSettingsOpen(!state.settingsOpen);
    });

    providerSelect.addEventListener("change", function () {
      state.provider = providerSelect.value;
      var list = modelsForProvider(state.provider);
      var keep = list.indexOf(state.model) >= 0 ? state.model : list[0];
      fillSelect(modelSelect, list, keep);
      state.model = modelSelect.value;
      post({ type: "setProvider", provider: providerSelect.value });
    });
    modelSelect.addEventListener("change", function () {
      state.model = modelSelect.value;
      post({ type: "setModel", model: modelSelect.value, provider: providerSelect.value });
    });
    modeSelect.addEventListener("change", function () {
      state.mode = modeSelect.value;
      post({ type: "setMode", mode: modeSelect.value });
    });

    function append(role, text, extraClass) {
      var node = el("div", { className: "mia-msg " + role + (extraClass ? " " + extraClass : "") });
      node.textContent = text;
      messages.appendChild(node);
      messages.scrollTop = messages.scrollHeight;
      return node;
    }

    var streamNode = null;

    function send() {
      var text = String(input.value || "").trim();
      if (!text || state.streaming) return;
      input.value = "";
      append("user", text);
      streamNode = append("assistant", "");
      state.streaming = true;
      post({ type: "send", text: text, provider: providerSelect.value });
    }

    sendBtn.addEventListener("click", send);
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        send();
      }
    });

    function applySession(session) {
      if (!session) return;
      state.provider = session.provider || state.provider;
      state.model = session.model || state.model;
      state.mode = session.mode || state.mode;
      providerSelect.value = state.provider;
      modeSelect.value = state.mode;
      fillSelect(modelSelect, modelsForProvider(state.provider), state.model);
      if (session.title) title.textContent = session.title;
      if (vscodeApi && vscodeApi.setState) {
        vscodeApi.setState({ sessionId: session.id });
      }
    }

    function modelsForProvider(id) {
      if (state.catalog && state.catalog[id] && state.catalog[id].length) {
        return uniqueList(state.catalog[id]);
      }
      return [];
    }

    function replayTranscript(items) {
      messages.innerHTML = "";
      (items || []).forEach(function (item) {
        append(item.role, item.text, item.role === "error" ? "error" : "");
      });
    }

    window.addEventListener("message", function (event) {
      var msg = event.data || {};
      if (msg.type === "init") {
        state.config = msg.config || state.config;
        if (state.config && state.config.fccEnabled === false) state.fccEnabled = false;
        else state.fccEnabled = true;
        state.catalog = msg.catalog || state.catalog || {};
        if (msg.session && msg.session.provider && msg.models) {
          state.catalog[msg.session.provider] = uniqueList(msg.models);
        }
        applyAppearance(state.config && state.config.ui);
        fillProviders();
        applySession(msg.session);
        replayTranscript(msg.session && msg.session.transcript);
      } else if (msg.type === "session") {
        applySession(msg.session);
      } else if (msg.type === "config") {
        state.config = msg.config;
        if (state.config && state.config.fccEnabled === false) state.fccEnabled = false;
        else if (state.config) state.fccEnabled = true;
        applyAppearance(state.config && state.config.ui);
        fillProviders();
        if (state.settingsOpen) renderSettings();
      } else if (msg.type === "fccStatus") {
        state.fccEnabled = msg.enabled !== false;
        state.fccOk = !!msg.ok;
        fillProviders();
        if (msg.models && msg.models.length) {
          state.catalog = state.catalog || {};
          state.catalog.fcc = msg.models;
          if (state.provider === "fcc") fillSelect(modelSelect, modelsForProvider("fcc"), state.model);
        }
        if (state.settingsOpen) renderSettings();
      } else if (msg.type === "models") {
        var owner = msg.provider || state.provider;
        state.catalog = state.catalog || {};
        if (msg.models && msg.models.length) {
          state.catalog[owner] = uniqueList(msg.models);
        }
        if (owner === state.provider) {
          fillSelect(modelSelect, modelsForProvider(state.provider), state.model);
        }
      } else if (msg.type === "showSettings") {
        renderSettings();
        setSettingsOpen(true);
      } else if (msg.type === "settingsSaved") {
        append("system", "Ajustes guardados.", "system");
        setSettingsOpen(false);
      } else if (msg.type === "provider") {
        state.provider = msg.provider;
        providerSelect.value = msg.provider;
        fillSelect(modelSelect, modelsForProvider(state.provider), state.model);
      } else if (msg.type === "authStatus") {
        var kind = msg.kind === "session" ? "sesión terminal" : msg.kind === "apiKey" ? "API key" : "sin credencial";
        var src = msg.source === "terminal" ? "login CLI" : msg.source === "env" ? "env" : msg.source === "settings" ? "settings" : "";
        authLabel.textContent = src ? kind + " · " + src : kind;
      } else if (msg.type === "status") {
        append("system", String(msg.text || ""), "system");
      } else if (msg.type === "delta") {
        if (!streamNode) streamNode = append("assistant", "", "streaming");
        streamNode.className = "mia-msg assistant streaming";
        streamNode.textContent += msg.text || "";
        messages.scrollTop = messages.scrollHeight;
      } else if (msg.type === "assistantDone") {
        if (streamNode) {
          streamNode.textContent = msg.text || streamNode.textContent;
          streamNode.className = "mia-msg assistant";
        }
        streamNode = null;
        state.streaming = false;
      } else if (msg.type === "error") {
        append("error", String(msg.message || msg.error || "Error"), "error");
        streamNode = null;
        state.streaming = false;
      } else if (msg.type === "edit") {
        renderEdit(messages, msg.edit, msg.apply || "ask");
      } else if (msg.type === "editResolved") {
        var card = document.getElementById("edit-" + msg.id);
        if (card) {
          var doneText =
            msg.action === "accept" ? "Aplicado — escrito en disco." : "Rechazado — el archivo original no cambia.";
          card.appendChild(el("div", { className: "mia-msg system", text: doneText }));
        }
      }
    });

    post({ type: "ready" });
  }

  function renderEdit(messages, edit, apply) {
    var card = el("div", { className: "mia-edit", id: "edit-" + edit.id });
    var path = el("header", {}, [el("span", { text: edit.path })]);
    var pre = el("pre", { text: (edit.diff && edit.diff.unified) || "" });
    card.appendChild(path);
    card.appendChild(pre);
    if (apply === "plan") {
      card.appendChild(el("div", { className: "mia-msg system", text: "Plan — no se escribe nada." }));
    } else if (apply === "auto") {
      card.appendChild(el("div", { className: "mia-msg system", text: "Autónomo — aplicado automáticamente." }));
    } else {
      var accept = el("button", { text: "Accept" });
      var reject = el("button", { text: "Reject", className: "secondary" });
      accept.addEventListener("click", function () {
        post({ type: "acceptEdit", id: edit.id });
      });
      reject.addEventListener("click", function () {
        post({ type: "rejectEdit", id: edit.id });
      });
      card.appendChild(el("div", {}, [accept, reject]));
    }
    messages.appendChild(card);
    messages.scrollTop = messages.scrollHeight;
  }

  global.__FH_IA__ = {
    ready: true,
    version: "0.1.7",
    mount: mount,
    post: post,
    state: state,
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        mount(document.getElementById("app"));
      });
    } else if (document.getElementById) {
      var app = document.getElementById("app");
      if (app) mount(app);
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
