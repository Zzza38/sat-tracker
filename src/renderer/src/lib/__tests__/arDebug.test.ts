import { beforeEach, describe, expect, it } from "vitest";
import {
  arDebugEntryCount,
  arDebugLog,
  arDebugPoi,
  arDebugSample,
  buildArDebugReport,
  clearArDebugLog,
  isArDebugEnabled,
  setArDebugEnabled
} from "../arDebug";

describe("ar debug log", () => {
  beforeEach(() => {
    setArDebugEnabled(false);
    clearArDebugLog();
  });

  it("records nothing while disabled", () => {
    arDebugLog("anchor-snap", { deltaDeg: 90 });
    arDebugSample("raw-relative", 0, { a: 1 });
    expect(isArDebugEnabled()).toBe(false);
    expect(arDebugEntryCount()).toBe(0);
  });

  it("records timestamped entries once enabled", () => {
    setArDebugEnabled(true);
    arDebugLog("anchor-snap", { deltaDeg: 90 });
    const report = buildArDebugReport();
    const snap = report.entries.find((entry) => entry.kind === "anchor-snap");
    expect(snap).toBeDefined();
    expect(snap!.deltaDeg).toBe(90);
    expect(typeof snap!.t).toBe("number");
    expect(snap!.t).toBeLessThanOrEqual(report.exportedAtPerfMs);
  });

  it("numbers POI markers and reports the total", () => {
    setArDebugEnabled(true);
    expect(arDebugPoi()).toBe(1);
    expect(arDebugPoi("flip happened")).toBe(2);
    const report = buildArDebugReport();
    expect(report.pois).toBe(2);
    const pois = report.entries.filter((entry) => entry.kind === "poi");
    expect(pois.map((entry) => entry.n)).toEqual([1, 2]);
    expect(pois[1].note).toBe("flip happened");
    expect(typeof pois[0].wall).toBe("string");
  });

  it("throttles high-rate samples per kind", () => {
    setArDebugEnabled(true);
    arDebugSample("raw-relative", 60_000, { a: 1 });
    arDebugSample("raw-relative", 60_000, { a: 2 });
    arDebugSample("raw-absolute", 60_000, { a: 3 });
    const entries = buildArDebugReport().entries;
    expect(entries.filter((entry) => entry.kind === "raw-relative")).toHaveLength(1);
    expect(entries.filter((entry) => entry.kind === "raw-absolute")).toHaveLength(1);
  });

  it("caps the buffer instead of growing without bound", () => {
    setArDebugEnabled(true);
    for (let index = 0; index < 25_000; index += 1) {
      arDebugLog("view", { i: index });
    }
    expect(arDebugEntryCount()).toBeLessThanOrEqual(20_000);
    // The newest entries survive; the oldest are the ones dropped.
    const entries = buildArDebugReport().entries;
    expect(entries[entries.length - 1].i).toBe(24_999);
  });

  it("includes device and calibration context in the report", () => {
    setArDebugEnabled(true);
    localStorage.setItem("sat-tracker-compass-trim", "3.5");
    const report = buildArDebugReport();
    expect(typeof report.exportedAt).toBe("string");
    expect(typeof report.userAgent).toBe("string");
    expect(report.settings.compassTrim).toBe("3.5");
  });
});
