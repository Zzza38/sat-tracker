import { useEffect, useState } from "react";

export function useAnimationFrameDate(active = true) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!active) {
      return;
    }

    let frame = 0;
    const tick = () => {
      setNow(new Date());
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  return now;
}
