export function isElectronRuntime() {
  // Prefer the preload bridge, but keep a user-agent fallback so the custom
  // titlebar still renders if the bridge is delayed or unavailable.
  return Boolean(window.electronAPI?.isElectron || navigator.userAgent.includes("Electron"));
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

  if (!("Notification" in window)) {
    return false;
  }
  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }
  if (Notification.permission !== "granted") {
    return false;
  }

  // Android exposes Notification but deliberately makes its constructor
  // illegal. Service-worker notifications are the portable web path.
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.showNotification(title, { body });
      return true;
    }
  }

  try {
    new Notification(title, { body });
    return true;
  } catch {
    return false;
  }
}

export async function requestNotificationPermission() {
  if (isElectronRuntime()) {
    return true;
  }

  if (!("Notification" in window)) {
    return false;
  }

  if (Notification.permission === "default") {
    return (await Notification.requestPermission()) === "granted";
  }

  return Notification.permission === "granted";
}
