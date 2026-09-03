import { describe, expect, it } from "vitest";
import {
  BulkPropagator, createSingleThreadRuntime, EcfPositionCalculator, EciBaseCalculator,
  GmstCalculator, LookAnglesCalculator, propagate, twoline2satrec
} from "satellite.js";
import { ISS_TLE } from "@/shared/__tests__/fixtures";
import { observerToGeodetic, radiansToDegrees } from "@/shared/observer/defaults";
import { DEFAULT_OBSERVER } from "@/shared/observer/defaults";

describe("scratch", () => {
  it("probes decayed behaviour", async () => {
    const satrec = twoline2satrec(ISS_TLE.line1, ISS_TLE.line2);
    // find a date where JS propagate returns null
    let failDate: Date | null = null;
    for (let year = 2019; year < 2060; year += 1) {
      const d = new Date(Date.UTC(year, 0, 1));
      if (!propagate(twoline2satrec(ISS_TLE.line1, ISS_TLE.line2), d)) { failDate = d; break; }
    }
    console.log("first failing date", failDate?.toISOString());
    expect(failDate).not.toBeNull();

    const dates = [new Date(Date.UTC(2019, 5, 5)), failDate!, new Date(failDate!.getTime() + 3600000)];
    const runtime = await createSingleThreadRuntime();
    const propagator = new BulkPropagator({
      runtime,
      calculators: [new EciBaseCalculator(), new GmstCalculator(), new EcfPositionCalculator(), new LookAnglesCalculator()],
      satRecsCount: 1,
      datesCount: dates.length
    });
    propagator.setSatRecs([twoline2satrec(ISS_TLE.line1, ISS_TLE.line2)]);
    propagator.setDates(dates);
    propagator.run({ lookAngles: { observer: observerToGeodetic(DEFAULT_OBSERVER) } });
    for (let i = 0; i < dates.length; i += 1) {
      const out = propagator.getFormattedOutput(0, i);
      console.log(i, dates[i].toISOString(), "err=", out?.eci.error, "lookAnglesTruthy=", Boolean(out?.lookAngles),
        "elDeg=", out?.lookAngles ? radiansToDegrees(out.lookAngles.elevation) : "n/a",
        "rangeKm=", out?.lookAngles?.rangeSat);
    }
    propagator.dispose();
    expect(satrec).toBeTruthy();
  });
});
