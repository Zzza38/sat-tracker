export interface ElevationColorOptions {
  minElevationDeg?: number;
  maxElevationDeg?: number;
}

const STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [33, 145, 140],
  [40, 174, 128],
  [94, 201, 97],
  [173, 220, 48],
  [253, 231, 37]
];

function sampleRamp(t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (STOPS.length - 1);
  const index = Math.min(Math.floor(scaled), STOPS.length - 2);
  const localT = scaled - index;
  const from = STOPS[index];
  const to = STOPS[index + 1];

  return [
    Math.round(from[0] + (to[0] - from[0]) * localT),
    Math.round(from[1] + (to[1] - from[1]) * localT),
    Math.round(from[2] + (to[2] - from[2]) * localT)
  ];
}

export function elevationToColor(
  elevationDeg: number,
  { minElevationDeg = 0, maxElevationDeg = 90 }: ElevationColorOptions = {}
) {
  const span = Math.max(maxElevationDeg - minElevationDeg, 1);
  const t = Math.min(1, Math.max(0, (elevationDeg - minElevationDeg) / span));
  const [r, g, b] = sampleRamp(t);

  return `rgb(${r} ${g} ${b})`;
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
  const [r, g, b] = sampleRamp(t);

  return `rgb(${r} ${g} ${b} / ${alpha})`;
}
