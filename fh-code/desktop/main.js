"use strict";

const { app, BrowserWindow } = require("electron");

app.commandLine.appendSwitch("no-sandbox");

const url = process.env.FH_CODE_URL || "http://127.0.0.1:3847";

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: "#141414",
    title: "fh-code",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(url);
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  app.quit();
});
