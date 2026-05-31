export interface ElevationColorOptions {
  minElevationDeg?: number;
  maxElevationDeg?: number;
}

export function elevationToColor(
  elevationDeg: number,
  { minElevationDeg = 0, maxElevationDeg = 90 }: ElevationColorOptions = {}
) {
  const span = Math.max(maxElevationDeg - minElevationDeg, 1);
  const t = Math.min(1, Math.max(0, (elevationDeg - minElevationDeg) / span));
  const hue = 12 + t * 128;

  return `hsl(${hue} 78% 58%)`;
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
  const hue = 12 + t * 128;

  return `hsla(${hue} 78% 58% / ${alpha})`;
}
