import { app, BrowserWindow, ipcMain, Notification, dialog, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  isValidNotificationRequest,
  isValidSaveFileRequest,
  isWindowControlAction
} from "./ipc-contract";

const TRUSTED_RENDERER_HOSTS = new Set([
  "desktop-zion",
  "desktop-zion.tail4dd51a.ts.net"
]);

function appIconPath() {
  return process.env.ELECTRON_RENDERER_URL
    ? path.resolve("public/sat-tracker-icon.ico")
    : path.join(__dirname, "../renderer/sat-tracker-icon.ico");
}

function isAllowedRendererUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (process.env.ELECTRON_RENDERER_URL) {
      const configuredRenderer = new URL(process.env.ELECTRON_RENDERER_URL);
      return (
        url.origin === configuredRenderer.origin ||
        (
          url.protocol === configuredRenderer.protocol &&
          url.port === configuredRenderer.port &&
          TRUSTED_RENDERER_HOSTS.has(url.hostname.toLowerCase())
        )
      );
    }

    const rendererDirectory = path.resolve(__dirname, "../renderer");
    const candidate = path.resolve(fileURLToPath(url));
    return candidate === rendererDirectory || candidate.startsWith(`${rendererDirectory}${path.sep}`);
  } catch {
    return false;
  }
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 360,
    minHeight: 620,
    backgroundColor: "#05070d",
    title: "Sat Tracker",
    icon: appIconPath(),
    frame: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#101114",
      symbolColor: "#f4f7fb",
      height: 42
    },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAllowedRendererUrl(url)) {
      return;
    }
    event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.sattracker.app");
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

function isTrustedSender(event: IpcMainInvokeEvent) {
  const url = event.senderFrame?.url;
  if (!url) {
    return false;
  }
  return isAllowedRendererUrl(url);
}

ipcMain.handle("save-file", async (event, content: unknown, defaultName: unknown) => {
  if (
    !isTrustedSender(event) ||
    !isValidSaveFileRequest(content, defaultName)
  ) {
    return false;
  }
  const safeContent = content as string;
  const safeDefaultName = defaultName as string;

  const result = await dialog.showSaveDialog({
    defaultPath: path.basename(safeDefaultName)
  });

  if (result.canceled || !result.filePath) {
    return false;
  }

  await fs.writeFile(result.filePath, safeContent, "utf8");
  return true;
});

ipcMain.handle("show-notification", async (event, title: unknown, body: unknown) => {
  if (
    !isTrustedSender(event) ||
    !isValidNotificationRequest(title, body) ||
    !Notification.isSupported()
  ) {
    return false;
  }
  const safeTitle = title as string;
  const safeBody = body as string;

  new Notification({ title: safeTitle, body: safeBody }).show();
  return true;
});

ipcMain.handle("window-control", (event, action: unknown) => {
  if (!isTrustedSender(event) || !isWindowControlAction(action)) {
    return false;
  }

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
