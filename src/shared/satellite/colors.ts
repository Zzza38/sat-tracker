export const DEFAULT_SATELLITE_COLORS = [
  "#65bd8e",
  "#6c8cff",
  "#e0707e",
  "#e0a458",
  "#b794f6",
  "#4fd1c5"
] as const;

export function resolveSatelliteColor(
  satelliteId: string,
  orderedIds: string[],
  customColors: Record<string, string> = {}
) {
  if (customColors[satelliteId]) {
    return customColors[satelliteId];
  }

  const index = orderedIds.indexOf(satelliteId);
  if (index === -1) {
    return DEFAULT_SATELLITE_COLORS[0];
  }

  return DEFAULT_SATELLITE_COLORS[index % DEFAULT_SATELLITE_COLORS.length];
}

export function cycleSatelliteColor(current: string) {
  const index = DEFAULT_SATELLITE_COLORS.indexOf(current as (typeof DEFAULT_SATELLITE_COLORS)[number]);
  const nextIndex = index === -1 ? 0 : (index + 1) % DEFAULT_SATELLITE_COLORS.length;
  return DEFAULT_SATELLITE_COLORS[nextIndex];
}
