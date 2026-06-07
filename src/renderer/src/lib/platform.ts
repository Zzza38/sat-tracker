export function isElectronRuntime() {
  return Boolean(window.electronAPI?.isElectron || navigator.userAgent.includes("Electron/"));
}

export async function saveTextFile(content: string, defaultName: string) {
  if (isElectronRuntime() && window.electronAPI) {
    return window.electronAPI.saveFile(content, defaultName);
  }

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = defaultName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

export async function notifyPass(title: string, body: string) {
  if (isElectronRuntime() && window.electronAPI) {
    return window.electronAPI.showNotification(title, body);
  }

  if ("Notification" in window) {
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }

    if (Notification.permission === "granted") {
      new Notification(title, { body });
      return true;
    }
  }

  return false;
}
