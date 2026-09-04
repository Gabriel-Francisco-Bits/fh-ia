"use strict";

const { spawn } = require("node:child_process");
const os = require("node:os");

class TerminalSession {
  constructor(id, cwd) {
    this.id = id;
    this.cwd = cwd;
    this.subscribers = new Set();
    this.history = [];
    this.maxHistory = 2000;

    const isWin = os.platform() === "win32";
    const shell = isWin
      ? process.env.COMSPEC || "cmd.exe"
      : process.env.SHELL || "/bin/bash";

    const args = isWin ? [] : ["-l"];

    this.proc = spawn(shell, args, {
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const onData = (chunk) => {
      const text = chunk.toString("utf8");
      this.history.push(text);
      if (this.history.length > this.maxHistory) {
        this.history.shift();
      }
      for (const cb of this.subscribers) {
        try {
          cb(text);
        } catch {
          // ignore
        }
      }
    };

    this.proc.stdout.on("data", onData);
    this.proc.stderr.on("data", onData);
    this.proc.on("exit", (code) => {
      const msg = `\r\n[Proceso de terminal finalizado con código ${code ?? 0}]\r\n`;
      onData(msg);
      this.closed = true;
    });
  }

  write(data) {
    if (this.proc && this.proc.stdin && !this.closed) {
      this.proc.stdin.write(data);
    }
  }

  subscribe(cb) {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  getHistory() {
    return this.history.join("");
  }

  kill() {
    if (this.proc && !this.closed) {
      this.proc.kill("SIGKILL");
      this.closed = true;
    }
  }
}

class TerminalManager {
  constructor() {
    this.sessions = new Map();
  }

  getOrCreate(id, cwd) {
    let s = this.sessions.get(id);
    if (!s || s.closed) {
      s = new TerminalSession(id, cwd);
      this.sessions.set(id, s);
    }
    return s;
  }

  get(id) {
    return this.sessions.get(id);
  }

  close(id) {
    const s = this.sessions.get(id);
    if (s) {
      s.kill();
      this.sessions.delete(id);
    }
  }

  closeAll() {
    for (const [id, s] of this.sessions) {
      s.kill();
    }
    this.sessions.clear();
  }
}

module.exports = { TerminalSession, TerminalManager };
