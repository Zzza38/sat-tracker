import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  platform: process.platform,
  saveFile: (content: string, defaultName: string) => ipcRenderer.invoke("save-file", content, defaultName),
  showNotification: (title: string, body: string) => ipcRenderer.invoke("show-notification", title, body),
  windowControl: (action: "minimize" | "maximize" | "close") => ipcRenderer.invoke("window-control", action),
  windowDragStart: (point: { screenX: number; screenY: number }) => ipcRenderer.invoke("window-drag-start", point),
  windowDragMove: (point: { screenX: number; screenY: number }) => ipcRenderer.invoke("window-drag-move", point),
  windowDragEnd: () => ipcRenderer.invoke("window-drag-end")
});
