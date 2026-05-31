import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  saveFile: (content: string, defaultName: string) => ipcRenderer.invoke("save-file", content, defaultName),
  showNotification: (title: string, body: string) => ipcRenderer.invoke("show-notification", title, body)
});
