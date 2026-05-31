interface ElevationColorLegendProps {
  minElevationDeg: number;
  maxElevationDeg?: number;
}

export function ElevationColorLegend({
  minElevationDeg,
  maxElevationDeg = 90
}: ElevationColorLegendProps) {
  return (
    <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
      <span className="mono">{minElevationDeg.toFixed(0)}°</span>
      <div
        className="h-2 flex-1 rounded-full border border-[var(--line)]"
        style={{
          background: `linear-gradient(to right, hsl(12 78% 58%), hsl(140 78% 58%))`
        }}
        aria-hidden="true"
      />
      <span className="mono">{maxElevationDeg.toFixed(0)}°</span>
    </div>
  );
}
