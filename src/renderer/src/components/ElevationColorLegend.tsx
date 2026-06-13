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
        className="h-2 flex-1 overflow-hidden rounded-full bg-[#e86240]"
        style={{
          backgroundImage: "linear-gradient(90deg, #e86240 0%, #e86240 7%, #e9a847 45%, #43d982 100%)"
        }}
        aria-hidden="true"
      />
      <span className="mono">{maxElevationDeg.toFixed(0)}°</span>
    </div>
  );
}
