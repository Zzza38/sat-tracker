import { useMemo } from "react";
import { elevationToColor } from "@/shared/passes/elevation-color";

interface ElevationColorLegendProps {
  minElevationDeg: number;
  maxElevationDeg?: number;
}

export function ElevationColorLegend({
  minElevationDeg,
  maxElevationDeg = 90
}: ElevationColorLegendProps) {
  const backgroundImage = useMemo(() => {
    const steps = 8;
    const stops = Array.from({ length: steps + 1 }, (_, i) => {
      const t = i / steps;
      const elevation = minElevationDeg + t * (maxElevationDeg - minElevationDeg);
      return `${elevationToColor(elevation, { minElevationDeg, maxElevationDeg })} ${(t * 100).toFixed(1)}%`;
    });
    return `linear-gradient(90deg, ${stops.join(", ")})`;
  }, [minElevationDeg, maxElevationDeg]);

  return (
    <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
      <span className="mono">{minElevationDeg.toFixed(0)}°</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ backgroundImage }} aria-hidden="true" />
      <span className="mono">{maxElevationDeg.toFixed(0)}°</span>
    </div>
  );
}
