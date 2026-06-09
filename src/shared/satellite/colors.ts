export const DEFAULT_SATELLITE_COLORS = [
  "#65bd8e",
  "#6c8cff",
  "#e0707e",
  "#e0a458",
  "#b794f6",
  "#4fd1c5"
] as const;

function hslToHex(hue: number, saturation: number, lightness: number) {
  const normalizedSaturation = saturation / 100;
  const normalizedLightness = lightness / 100;
  const chroma = (1 - Math.abs(2 * normalizedLightness - 1)) * normalizedSaturation;
  const huePrime = hue / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const match = normalizedLightness - chroma / 2;
  const [red, green, blue] =
    huePrime < 1 ? [chroma, x, 0] :
    huePrime < 2 ? [x, chroma, 0] :
    huePrime < 3 ? [0, chroma, x] :
    huePrime < 4 ? [0, x, chroma] :
    huePrime < 5 ? [x, 0, chroma] :
    [chroma, 0, x];

  return [red, green, blue]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0"))
    .join("");
}

function generatedSatelliteColor(index: number) {
  const hue = (index * 137.508) % 360;
  const saturation = 68 + (index % 3) * 7;
  const lightness = 58 + (index % 4) * 5;
  return `#${hslToHex(hue, saturation, lightness)}`;
}

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

  return index < DEFAULT_SATELLITE_COLORS.length
    ? DEFAULT_SATELLITE_COLORS[index]
    : generatedSatelliteColor(index);
}

export function cycleSatelliteColor(current: string) {
  const index = DEFAULT_SATELLITE_COLORS.indexOf(current as (typeof DEFAULT_SATELLITE_COLORS)[number]);
  const nextIndex = index === -1 ? 0 : (index + 1) % DEFAULT_SATELLITE_COLORS.length;
  return DEFAULT_SATELLITE_COLORS[nextIndex];
}
