export {};

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      saveFile: (content: string, defaultName: string) => Promise<boolean>;
      showNotification: (title: string, body: string) => Promise<boolean>;
      windowControl: (action: "minimize" | "maximize" | "close") => Promise<boolean>;
    };
  }
}
