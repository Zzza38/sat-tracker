import { RefreshIntervalUnit, TleSource } from "@/shared/types";

export const DEFAULT_TLE_SOURCES: TleSource[] = [
  createUrlTleSource("https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=JSON", "stations"),
  createUrlTleSource("https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=JSON", "active"),
  createUrlTleSource("https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=JSON", "visual"),
  createUrlTleSource("https://celestrak.org/NORAD/elements/gp.php?GROUP=last-30-days&FORMAT=JSON", "last-30-days"),
  createUrlTleSource("https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=JSON", "weather"),
  createUrlTleSource("https://celestrak.org/NORAD/elements/gp.php?GROUP=science&FORMAT=JSON", "science")
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

export function createUrlTleSource(url: string, id = createTleSourceId()): TleSource {
  return {
    id,
    name: url,
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
