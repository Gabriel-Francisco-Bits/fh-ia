"use strict";

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const fssync = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("ozone-platform-hint", "auto");

const port = process.env.FH_IA_EDITOR_PORT || 3847;
const url = process.env.FH_CODE_URL || `http://127.0.0.1:${port}`;
let mainWindow = null;
let serverProcess = null;

function pingServer(timeoutMs = 500) {
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

async function ensureServer() {
  const isUp = await pingServer(400);
  if (isUp) return;

  const serverScript = path.join(__dirname, "..", "server.js");
  if (!fssync.existsSync(serverScript)) return;

  serverProcess = spawn(process.execPath, [serverScript], {
    stdio: "inherit",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    cwd: path.join(__dirname, "..", ".."),
  });

  // Wait up to 5s for server to respond
  const start = Date.now();
  while (Date.now() - start < 5000) {
    await new Promise((r) => setTimeout(r, 150));
    if (await pingServer(300)) break;
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, "icon.png");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: "#141414",
    title: "fh-code",
    icon: fssync.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.warn(`Reintentando conectar a ${url} (${errorCode}: ${errorDescription})...`);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(url);
      }
    }, 500);
  });

  mainWindow.loadURL(url);
}

ipcMain.handle("dialog:openFolder", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Abrir carpeta en fh-code",
    properties: ["openDirectory", "createDirectory"],
  });
  if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

app.whenReady().then(async () => {
  await ensureServer();
  createWindow();
});

app.on("window-all-closed", () => {
  if (serverProcess) {
    try { serverProcess.kill(); } catch {}
  }
  app.quit();
});

app.on("before-quit", () => {
  if (serverProcess) {
    try { serverProcess.kill(); } catch {}
  }
});
