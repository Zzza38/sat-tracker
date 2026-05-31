import { describe, expect, it } from "vitest";
import { DEFAULT_OBSERVER } from "@/shared/observer/defaults";
import { predictPassesForSatellite } from "@/shared/passes/predictor-core";
import { createSatelliteRecord, parseElementInput } from "@/shared/tle/parser";
import { ISS_TLE } from "@/shared/__tests__/fixtures";

describe("pass predictor", () => {
  const record = createSatelliteRecord(
    parseElementInput(`${ISS_TLE.line1}\n${ISS_TLE.line2}`),
    "manual"
  );

  it("finds at least one pass in a two-day window", () => {
    const passes = predictPassesForSatellite(record, DEFAULT_OBSERVER, {
      start: new Date("2019-06-05T00:00:00Z"),
      end: new Date("2019-06-07T00:00:00Z"),
      minElevationDeg: 5,
      stepSeconds: 30
    });

    expect(passes.length).toBeGreaterThan(0);
    expect(passes[0].maxElevationDeg).toBeGreaterThan(5);
    expect(passes[0].samples.length).toBeGreaterThan(2);
  });
});
