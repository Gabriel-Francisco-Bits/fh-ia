#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const port = String(process.env.FH_IA_EDITOR_PORT || 3847);
const serverScript = path.join(__dirname, "server.js");
const extra = process.argv.slice(2);
const child = spawn(process.execPath, [serverScript, ...extra], {
  stdio: "inherit",
  env: process.env,
  cwd: path.join(__dirname, ".."),
});

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      http
        .get(`http://127.0.0.1:${port}/api/meta`, (res) => {
          res.resume();
          resolve();
        })
        .on("error", () => {
          if (Date.now() - started > 20000) {
            reject(new Error("fh-code server did not start"));
            return;
          }
          setTimeout(tick, 120);
        });
    };
    tick();
  });
}

function maybeOpenDesktop() {
  if (process.env.FH_CODE_NO_ELECTRON === "1") {
    return;
  }
  let electronBin;
  try {
    electronBin = require("electron");
  } catch {
    return;
  }
  if (typeof electronBin !== "string") {
    return;
  }
  const desktop = spawn(electronBin, ["--no-sandbox", path.join(__dirname, "desktop", "main.js")], {
    stdio: "inherit",
    env: { ...process.env, FH_CODE_URL: `http://127.0.0.1:${port}` },
  });
  desktop.on("error", () => {
    /* HTTP UI remains available */
  });
}

waitForServer()
  .then(maybeOpenDesktop)
  .catch((err) => {
    console.error(err);
    child.kill();
    process.exit(1);
  });

child.on("exit", (code) => {
  process.exit(code || 0);
});
