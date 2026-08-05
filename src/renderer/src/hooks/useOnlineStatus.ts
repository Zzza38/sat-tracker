import { useEffect, useState } from "react";
import { isBrowserOnline } from "@/shared/catalog/offline-seed";

export function useOnlineStatus() {
  const [online, setOnline] = useState(isBrowserOnline);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    setOnline(isBrowserOnline());
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return online;
}
