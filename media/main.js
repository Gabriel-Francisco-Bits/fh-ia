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
    streaming: false,
  };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "className") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
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

  function mount(root) {
    if (!root) return;

    root.innerHTML = "";
    root.className = "mia-root";

    var select = el("select", { id: "mia-provider" }, [
      el("option", { value: "claude", text: "Claude" }),
      el("option", { value: "grok", text: "Grok" }),
      el("option", { value: "openai", text: "OpenAI-compatible" }),
    ]);
    select.value = state.provider;
    select.addEventListener("change", function () {
      state.provider = select.value;
      post({ type: "setProvider", provider: select.value });
    });

    var authLabel = el("span", { id: "mia-auth", className: "mia-auth", text: "" });
    var header = el("div", { className: "mia-header" }, [
      el("h1", { text: "fh-ia" }),
      authLabel,
      select,
    ]);

    var messages = el("div", { className: "mia-messages", id: "mia-messages" });
    var hint = el("div", {
      className: "mia-hint",
      text: "The active editor file and selection are attached automatically. Use @path to attach extra files.",
    });

    var input = el("textarea", {
      id: "mia-input",
      placeholder: "Ask Claude, Grok, or another IA…",
    });
    var sendBtn = el("button", { id: "mia-send", text: "Send" });
    var composer = el("div", { className: "mia-composer" }, [input, sendBtn]);

    root.appendChild(header);
    root.appendChild(messages);
    root.appendChild(hint);
    root.appendChild(composer);

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
      post({ type: "send", text: text, provider: select.value });
    }

    sendBtn.addEventListener("click", send);
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        send();
      }
    });

    window.addEventListener("message", function (event) {
      var msg = event.data || {};
      if (msg.type === "provider") {
        state.provider = msg.provider;
        select.value = msg.provider;
      } else if (msg.type === "authStatus") {
        var kind = msg.kind === "session" ? "sesión terminal" : msg.kind === "apiKey" ? "API key" : "sin credencial";
        var src = msg.source === "terminal" ? "login CLI" : msg.source === "env" ? "env" : msg.source === "settings" ? "settings" : "";
        authLabel.textContent = src ? kind + " · " + src : kind;
      } else if (msg.type === "status") {
        append("system", String(msg.text || ""), "system");
      } else if (msg.type === "delta") {
        if (!streamNode) streamNode = append("assistant", "");
        streamNode.textContent += msg.text || "";
        messages.scrollTop = messages.scrollHeight;
      } else if (msg.type === "assistantDone") {
        if (streamNode) streamNode.textContent = msg.text || streamNode.textContent;
        streamNode = null;
        state.streaming = false;
      } else if (msg.type === "error") {
        append("error", String(msg.message || msg.error || "Error"), "error");
        streamNode = null;
        state.streaming = false;
      } else if (msg.type === "edit") {
        renderEdit(messages, msg.edit);
      } else if (msg.type === "editResolved") {
        var card = document.getElementById("edit-" + msg.id);
        if (card) {
          card.appendChild(el("div", { className: "mia-msg system", text: msg.action === "accept" ? "Accepted — written to disk." : "Rejected — original file unchanged." }));
        }
      }
    });

    post({ type: "ready" });
  }

  function renderEdit(messages, edit) {
    var card = el("div", { className: "mia-edit", id: "edit-" + edit.id });
    var path = el("header", {}, [el("span", { text: edit.path })]);
    var pre = el("pre", { text: (edit.diff && edit.diff.unified) || "" });
    var accept = el("button", { text: "Accept" });
    var reject = el("button", { text: "Reject", className: "secondary" });
    accept.addEventListener("click", function () {
      post({ type: "acceptEdit", id: edit.id });
    });
    reject.addEventListener("click", function () {
      post({ type: "rejectEdit", id: edit.id });
    });
    var actions = el("div", {}, [accept, reject]);
    card.appendChild(path);
    card.appendChild(pre);
    card.appendChild(actions);
    messages.appendChild(card);
    messages.scrollTop = messages.scrollHeight;
  }

  global.__FH_IA__ = {
    ready: true,
    version: "0.1.2",
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
