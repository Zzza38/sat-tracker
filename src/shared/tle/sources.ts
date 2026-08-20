import { RefreshIntervalUnit, TleSource } from "@/shared/types";

export const DEFAULT_TLE_SOURCES: TleSource[] = [
  createUrlTleSource(
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=JSON",
    "stations",
    "Space stations"
  )
];

export function refreshIntervalToHours(value: number, unit: RefreshIntervalUnit) {
  switch (unit) {
    case "days":
      return value * 24;
    case "weeks":
      return value * 24 * 7;
    default:
      return value;
  }
}

export function createTleSourceId() {
  return `source-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createUrlTleSource(url: string, id = createTleSourceId(), name = url): TleSource {
  return {
    id,
    name,
    endpoint: "url",
    url
  };
}

export function tleSourceUrl(source: TleSource) {
  if (source.endpoint === "url") {
    return source.url ?? source.name;
  }

  if (source.endpoint === "supplemental") {
    const url = new URL("https://celestrak.org/NORAD/elements/supplemental/sup-gp.php");
    url.searchParams.set("FILE", source.supplementalFile ?? "");
    url.searchParams.set("FORMAT", "JSON");
    return url.toString();
  }

  const url = new URL("https://celestrak.org/NORAD/elements/gp.php");
  url.searchParams.set("GROUP", source.group ?? "");
  url.searchParams.set("FORMAT", "JSON");
  return url.toString();
}

export function updateTleSourceUrl(source: TleSource, url: string): TleSource {
  return {
    ...source,
    name: url,
    endpoint: "url",
    group: undefined,
    supplementalFile: undefined,
    url
  };
}
