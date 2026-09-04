"use strict";

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const fssync = require("node:fs");
const path = require("node:path");

app.commandLine.appendSwitch("no-sandbox");

const url = process.env.FH_CODE_URL || "http://127.0.0.1:3847";
let mainWindow = null;

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

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  app.quit();
});
