import { SatRecError } from "satellite.js";
import { describe, expect, it } from "vitest";
import { ISS_TLE } from "@/shared/__tests__/fixtures";
import { DEFAULT_OBSERVER } from "@/shared/observer/defaults";
import { isUsableBulkPropagationSample, predictPassesBulkWasm } from "@/shared/passes/predictor-bulk";
import {
  passesToCsv,
  passesToIcs,
  predictPassesForSatellite
} from "@/shared/passes/predictor-core";
import { computeOrbitSnapshot } from "@/shared/propagation/engine";
import { createSatelliteRecord, parseElementInput } from "@/shared/tle/parser";

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

  it("uses minimum elevation only as a max-elevation filter", () => {
    const [pass] = predictPassesForSatellite(record, DEFAULT_OBSERVER, {
      start: new Date("2019-06-05T00:00:00Z"),
      end: new Date("2019-06-07T00:00:00Z"),
      minElevationDeg: 5,
      stepSeconds: 30
    });

    const aosElevation = computeOrbitSnapshot(record, new Date(pass.aos), DEFAULT_OBSERVER).elevationDeg;
    const losElevation = computeOrbitSnapshot(record, new Date(pass.los), DEFAULT_OBSERVER).elevationDeg;

    expect(pass.maxElevationDeg).toBeGreaterThan(5);
    expect(Math.abs(aosElevation)).toBeLessThan(0.2);
    expect(Math.abs(losElevation)).toBeLessThan(0.2);
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
    const passes = await predictPassesBulkWasm(
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
      );

    expect(passes.every((pass) => pass.satelliteId === record.id)).toBe(true);
    expect(passes.some((pass) => pass.satelliteId === "invalid")).toBe(false);
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

  it("does not fabricate AOS when the prediction window starts during a pass", () => {
    const passes = predictPassesForSatellite(record, DEFAULT_OBSERVER, {
      start: new Date("2019-06-05T00:00:00Z"),
      end: new Date("2019-06-07T00:00:00Z"),
      minElevationDeg: 5,
      stepSeconds: 30
    });
    const first = passes[0];
    const clipped = predictPassesForSatellite(record, DEFAULT_OBSERVER, {
      start: new Date((new Date(first.aos).getTime() + new Date(first.los).getTime()) / 2),
      end: new Date("2019-06-07T00:00:00Z"),
      minElevationDeg: 5,
      stepSeconds: 30
    });

    expect(clipped.length).toBeGreaterThan(0);
    expect(new Date(clipped[0].aos).getTime()).toBeGreaterThan(new Date(first.los).getTime());
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

  it("rejects decayed WASM samples that still carry look angles", () => {
    expect(isUsableBulkPropagationSample({
      eci: { error: SatRecError.None },
      lookAngles: { elevation: 0.1 }
    })).toBe(true);
    expect(isUsableBulkPropagationSample({
      eci: { error: SatRecError.Decayed },
      lookAngles: { elevation: 0, rangeSat: Number.POSITIVE_INFINITY }
    })).toBe(false);
    expect(isUsableBulkPropagationSample({ eci: { error: SatRecError.None } })).toBe(false);
  });

  it("finds multi-satellite passes on the WASM path", async () => {
    const other = { ...record, id: "iss-copy", name: "ISS copy" };
    const passes = await predictPassesBulkWasm([record, other], DEFAULT_OBSERVER, {
      start: new Date("2019-06-05T00:00:00Z"),
      end: new Date("2019-06-07T00:00:00Z"),
      minElevationDeg: 5,
      stepSeconds: 60
    });

    expect(passes.length).toBeGreaterThan(0);
    expect(passes.every((pass) => pass.maxElevationDeg >= 5)).toBe(true);
  });

  it("does not invent passes after SGP4 decay on the WASM path", async () => {
    const other = { ...record, id: "iss-copy", name: "ISS copy" };
    const passes = await predictPassesBulkWasm([record, other], DEFAULT_OBSERVER, {
      start: new Date("2036-01-01T00:00:00Z"),
      end: new Date("2036-01-02T00:00:00Z"),
      minElevationDeg: 0,
      stepSeconds: 60
    });

    expect(passes).toEqual([]);
  });

  it("neutralizes spreadsheet formulas and emits standards-compliant ICS events", () => {
    const [pass] = predictPassesForSatellite(record, DEFAULT_OBSERVER, {
      start: new Date("2019-06-05T00:00:00Z"),
      end: new Date("2019-06-07T00:00:00Z"),
      minElevationDeg: 5,
      stepSeconds: 30
    });
    const dangerous = { ...pass, satelliteName: `=HYPERLINK("https://example.com")${"é".repeat(80)}` };
    const csv = passesToCsv([dangerous]);
    const ics = passesToIcs([dangerous], "Observer");

    expect(csv).toContain(`"'=HYPERLINK`);
    expect(ics).toMatch(/\r\nDTSTAMP:\d{8}T\d{6}Z\r\n/);
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});
