import { isElectronRuntime } from "./platform";

/** Register the web service worker so a visited build can load without network. */
export async function registerWebOfflineSupport() {
  if (typeof window === "undefined" || isElectronRuntime()) {
    return;
  }

  if (!("serviceWorker" in navigator)) {
    return;
  }

  const { registerSW } = await import("virtual:pwa-register");
  registerSW({ immediate: true });
}
