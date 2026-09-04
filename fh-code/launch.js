#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const port = String(process.env.FH_IA_EDITOR_PORT || 3847);
const serverScript = path.join(__dirname, "server.js");
const extra = process.argv.slice(2);

function pingServer(timeoutMs = 600) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/auth/me`, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitForServer(maxWaitMs = 15000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      const ok = await pingServer(400);
      if (ok) return resolve();
      if (Date.now() - started > maxWaitMs) {
        return reject(new Error("fh-code server did not start within timeout"));
      }
      setTimeout(tick, 150);
    };
    tick();
  });
}

function openDesktop() {
  if (process.env.FH_CODE_NO_ELECTRON === "1") {
    return null;
  }
  let electronBin;
  try {
    electronBin = require("electron");
  } catch {
    return null;
  }
  if (typeof electronBin !== "string") {
    return null;
  }
  const desktop = spawn(electronBin, ["--no-sandbox", "--disable-gpu", "--disable-gpu-sandbox", path.join(__dirname, "desktop", "main.js")], {
    stdio: "inherit",
    env: { ...process.env, FH_CODE_URL: `http://127.0.0.1:${port}` },
  });
  desktop.on("error", (err) => {
    console.error("No se pudo iniciar la ventana de escritorio:", err.message);
  });
  return desktop;
}

async function main() {
  const alreadyRunning = await pingServer(800);
  let child = null;

  if (alreadyRunning) {
    console.log(`fh-code ya se está ejecutando en http://127.0.0.1:${port}`);
  } else {
    child = spawn(process.execPath, [serverScript, ...extra], {
      stdio: "inherit",
      env: process.env,
      cwd: path.join(__dirname, ".."),
    });

    child.on("exit", (code) => {
      // If child crashed but server is not running
      if (code !== 0 && code !== null) {
        pingServer(400).then((running) => {
          if (!running) {
            console.error(`fh-code server terminó con código ${code}`);
            process.exit(code);
          }
        });
      }
    });

    await waitForServer();
  }

  const desktop = openDesktop();
  if (desktop) {
    desktop.on("exit", (code) => {
      if (child) {
        try { child.kill(); } catch {}
      }
      process.exit(code || 0);
    });
  } else if (!alreadyRunning && child) {
    console.log(`fh-code disponible en http://127.0.0.1:${port}`);
  }
}

main().catch((err) => {
  console.error("Error al iniciar fh-code:", err);
  process.exit(1);
});

