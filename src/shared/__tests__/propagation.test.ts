import { describe, expect, it } from "vitest";
import { DEFAULT_OBSERVER } from "@/shared/observer/defaults";
import {
  computeOrbitSnapshot,
  getOrbitMetrics,
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
    expect(snapshot.timestamp).toBe("2019-06-05T12:30:00.000Z");
    expect(snapshot.latitudeDeg).toBeGreaterThan(-90);
    expect(snapshot.latitudeDeg).toBeLessThan(90);
    expect(snapshot.longitudeDeg).toBeGreaterThanOrEqual(-180);
    expect(snapshot.longitudeDeg).toBeLessThanOrEqual(180);
    expect(snapshot.altitudeKm).toBeGreaterThan(350);
    expect(snapshot.altitudeKm).toBeLessThan(500);
    expect(snapshot.azimuthDeg).toBeGreaterThanOrEqual(0);
    expect(snapshot.azimuthDeg).toBeLessThan(360);
    expect(snapshot.elevationDeg).toBeGreaterThanOrEqual(-90);
    expect(snapshot.elevationDeg).toBeLessThanOrEqual(90);
    expect(snapshot.rangeKm).toBeGreaterThan(0);
    expect(snapshot.velocityKmS).toBeGreaterThan(7);
    expect(snapshot.velocityKmS).toBeLessThan(8);
    expect(typeof snapshot.sunlit).toBe("boolean");
  });
});
