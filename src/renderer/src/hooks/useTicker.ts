import { useEffect, useState } from "react";

export function useTicker(intervalMs = 1000, enabled = true) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, enabled]);

  return now;
}
