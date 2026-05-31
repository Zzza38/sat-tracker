import { app, BrowserWindow, ipcMain, Notification, dialog } from "electron";
import path from "node:path";
import fs from "node:fs/promises";

function appIconPath() {
  return process.env.ELECTRON_RENDERER_URL
    ? path.resolve("public/sat-tracker-icon.svg")
    : path.join(__dirname, "../renderer/sat-tracker-icon.svg");
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#05070d",
    title: "Sat Tracker",
    icon: appIconPath(),
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("save-file", async (_event, content: string, defaultName: string) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName
  });

  if (result.canceled || !result.filePath) {
    return false;
  }

  await fs.writeFile(result.filePath, content, "utf8");
  return true;
});

ipcMain.handle("show-notification", async (_event, title: string, body: string) => {
  if (!Notification.isSupported()) {
    return false;
  }

  new Notification({ title, body }).show();
  return true;
});

ipcMain.handle("window-control", (event, action: "minimize" | "maximize" | "close") => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    return false;
  }

  if (action === "minimize") {
    window.minimize();
    return true;
  }

  if (action === "maximize") {
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
    return true;
  }

  window.close();
  return true;
});
