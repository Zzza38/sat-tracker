import { RefreshIntervalUnit, TleSource } from "@/shared/types";

export const DEFAULT_TLE_SOURCES: TleSource[] = [
  { id: "stations", name: "Space stations", endpoint: "gp", group: "stations" },
  { id: "active", name: "Active satellites", endpoint: "gp", group: "active" },
  { id: "visual", name: "Bright / visual", endpoint: "gp", group: "visual" },
  { id: "last-30-days", name: "Last 30 days", endpoint: "gp", group: "last-30-days" },
  { id: "weather", name: "Weather", endpoint: "gp", group: "weather" },
  { id: "science", name: "Science", endpoint: "gp", group: "science" }
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
  return `source-${Date.now().toString(36)}`;
}
