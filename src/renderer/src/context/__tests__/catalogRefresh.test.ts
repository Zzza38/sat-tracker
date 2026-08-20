import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogNeedsRefresh } from "../AppContext";
import type { SettingsRow } from "@/shared/db";
import type { SatelliteRecord } from "@/shared/types";

const settings: SettingsRow = {
  id: "app",
  activeObserverId: "default",
  refreshIntervalValue: 12,
  refreshIntervalUnit: "hours",
  tleSources: [{ id: "stations", name: "Stations", endpoint: "url", url: "https://example.com" }],
  defaultTleSourceId: "stations",
  trackOnAdd: false,
  hiddenSatelliteIds: [],
  satelliteColors: {}
};

function record(source: SatelliteRecord["source"], fetchedAt: string): SatelliteRecord {
  return {
    id: `${source}-${fetchedAt}`,
    noradId: "25544",
    name: "ISS",
    format: "tle",
    source,
    fetchedAt
  };
}

describe("catalog refresh policy", () => {
  const now = new Date("2026-08-20T20:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes a bundled-only catalog until an online import succeeds", () => {
    const seed = record("seed", "2026-08-05T00:00:00Z");
    expect(catalogNeedsRefresh([seed], { ...settings, initialSourcesFetched: false })).toBe(true);
    expect(catalogNeedsRefresh([seed], { ...settings, initialSourcesFetched: true })).toBe(true);
  });

  it("ignores leftover seed rows after a fresh online import", () => {
    const seed = record("seed", "2026-08-05T00:00:00Z");
    const fetched = record("celestrak", now.toISOString());
    expect(catalogNeedsRefresh([seed, fetched], { ...settings, initialSourcesFetched: true })).toBe(false);
  });

  it("refreshes when the online catalog has aged past the interval", () => {
    const stale = record("celestrak", "2026-08-20T07:59:59Z");
    expect(catalogNeedsRefresh([stale], { ...settings, initialSourcesFetched: true })).toBe(true);
  });
});
