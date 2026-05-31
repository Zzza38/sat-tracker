import { describe, expect, it } from "vitest";
import { DEFAULT_OBSERVER } from "@/shared/observer/defaults";
import {
  computeDopplerFrequency,
  computeOrbitSnapshot,
  downlinkHzToMhzInput,
  formatDopplerShift,
  formatDopplerShiftLabel,
  getOrbitMetrics,
  parseDownlinkMhzInput,
  satrecFromRecord
} from "@/shared/propagation/engine";
import { createSatelliteRecord, parseElementInput } from "@/shared/tle/parser";
import { ISS_TLE } from "@/shared/__tests__/fixtures";

describe("propagation engine", () => {
  const record = createSatelliteRecord(
    parseElementInput(`${ISS_TLE.line1}\n${ISS_TLE.line2}`),
    "manual"
  );

  it("builds a satrec from a record", () => {
    const satrec = satrecFromRecord(record);
    expect(satrec.satnum).toBe("25544");
  });

  it("computes orbit metrics", () => {
    const metrics = getOrbitMetrics(record);
    expect(metrics.inclinationDeg).toBeGreaterThan(50);
    expect(metrics.periodMin).toBeGreaterThan(80);
  });

  it("computes a live snapshot for an observer", () => {
    const snapshot = computeOrbitSnapshot(record, new Date("2019-06-05T12:30:00Z"), DEFAULT_OBSERVER);
    expect(snapshot.latitudeDeg).toBeGreaterThan(-90);
    expect(snapshot.latitudeDeg).toBeLessThan(90);
    expect(snapshot.rangeKm).toBeGreaterThan(0);
  });

  it("computes Doppler frequency from a nominal downlink", () => {
    const nominalHz = 437_500_000;
    const dopplerFactor = 1.000005;

    expect(parseDownlinkMhzInput("437.5")).toBe(nominalHz);
    expect(downlinkHzToMhzInput(nominalHz)).toBe("437.5");
    expect(formatDopplerShift(dopplerFactor, nominalHz)).toBeCloseTo(2187.5, 1);
    expect(computeDopplerFrequency(nominalHz, dopplerFactor)).toBeCloseTo(437_502_187.5, 0);
    expect(formatDopplerShiftLabel(2187.5)).toBe("+2.188 kHz");
  });
});
