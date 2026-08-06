export interface ElevationColorOptions {
  minElevationDeg?: number;
  maxElevationDeg?: number;
}

// Red near the horizon → semi-neon green at high elevation.
// Hue 12→140 at 78% sat / 58% light keeps the green halfway neon (readable, not full blast).
function elevationHue(t: number) {
  return 12 + t * 128;
}

export function elevationToColor(
  elevationDeg: number,
  { minElevationDeg = 0, maxElevationDeg = 90 }: ElevationColorOptions = {}
) {
  const span = Math.max(maxElevationDeg - minElevationDeg, 1);
  const t = Math.min(1, Math.max(0, (elevationDeg - minElevationDeg) / span));

  return `hsl(${elevationHue(t)} 78% 58%)`;
}

export function elevationToColorWithAlpha(
  elevationDeg: number,
  alpha: number,
  options?: ElevationColorOptions
) {
  const span = Math.max((options?.maxElevationDeg ?? 90) - (options?.minElevationDeg ?? 0), 1);
  const t = Math.min(
    1,
    Math.max(0, (elevationDeg - (options?.minElevationDeg ?? 0)) / span)
  );

  return `hsla(${elevationHue(t)} 78% 58% / ${alpha})`;
}
