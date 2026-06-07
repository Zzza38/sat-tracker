/// <reference types="vite/client" />

export {};

declare global {
  const CESIUM_BASE_URL: string;

  interface Window {
    electronAPI?: {
      isElectron: boolean;
      saveFile: (content: string, defaultName: string) => Promise<boolean>;
      showNotification: (title: string, body: string) => Promise<boolean>;
      windowControl: (action: "minimize" | "maximize" | "close") => Promise<boolean>;
    };
  }
}
