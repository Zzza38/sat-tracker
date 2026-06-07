import { describe, expect, it } from "vitest";
import { DEFAULT_OBSERVER } from "@/shared/observer/defaults";
import {
  passesToCsv,
  passesToIcs,
  predictPassesForSatellite
} from "@/shared/passes/predictor-core";
import { predictPassesBulkWasm } from "@/shared/passes/predictor-bulk";
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

  it("rejects non-positive step sizes", () => {
    expect(() =>
      predictPassesForSatellite(record, DEFAULT_OBSERVER, {
        start: new Date("2019-06-05T00:00:00Z"),
        end: new Date("2019-06-05T01:00:00Z"),
        stepSeconds: 0
      })
    ).toThrow(/greater than zero/);
  });

  it("rejects non-positive bulk step sizes", async () => {
    await expect(
      predictPassesBulkWasm([record, record], DEFAULT_OBSERVER, {
        start: new Date("2019-06-05T00:00:00Z"),
        end: new Date("2019-06-05T01:00:00Z"),
        stepSeconds: 0
      })
    ).rejects.toThrow(/greater than zero/);
  });

  it("isolates records without usable orbital elements in bulk prediction", async () => {
    await expect(
      predictPassesBulkWasm(
        [
          record,
          {
            ...record,
            id: "invalid",
            name: "Invalid",
            tle: undefined,
            omm: undefined
          }
        ],
        DEFAULT_OBSERVER,
        {
          start: new Date("2019-06-05T00:00:00Z"),
          end: new Date("2019-06-05T01:00:00Z"),
          stepSeconds: 60
        }
      )
    ).resolves.toEqual(expect.any(Array));
  });

  it("does not fabricate LOS when the prediction window ends during a pass", () => {
    const [pass] = predictPassesForSatellite(record, DEFAULT_OBSERVER, {
      start: new Date("2019-06-05T00:00:00Z"),
      end: new Date("2019-06-07T00:00:00Z"),
      minElevationDeg: 5,
      stepSeconds: 30
    });

    const clipped = predictPassesForSatellite(record, DEFAULT_OBSERVER, {
      start: new Date(new Date(pass.aos).getTime() - 60000),
      end: new Date(pass.tca),
      minElevationDeg: 5,
      stepSeconds: 30
    });

    expect(clipped).toEqual([]);
  });

  it("escapes CSV and ICS text fields", () => {
    const [pass] = predictPassesForSatellite(record, DEFAULT_OBSERVER, {
      start: new Date("2019-06-05T00:00:00Z"),
      end: new Date("2019-06-07T00:00:00Z"),
      minElevationDeg: 5,
      stepSeconds: 30
    });
    const namedPass = { ...pass, satelliteName: 'SAT, "ONE";\nNEXT' };

    expect(passesToCsv([namedPass])).toContain('"SAT, ""ONE"";\nNEXT"');
    expect(passesToIcs([namedPass], "Site, One")).toContain(
      "SUMMARY:SAT\\, \"ONE\"\\;\\nNEXT pass over Site\\, One"
    );
  });
});
