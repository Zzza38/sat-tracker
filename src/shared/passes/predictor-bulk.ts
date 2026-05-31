import {
  BulkPropagator,
  createSingleThreadRuntime,
  EcfPositionCalculator,
  EciBaseCalculator,
  GmstCalculator,
  LookAnglesCalculator,
  ShadowFractionCalculator,
  SunPositionCalculator
} from "satellite.js";
import { observerToGeodetic, radiansToDegrees } from "@/shared/observer/defaults";
import { predictPassesForSatellite, type PassPredictOptions } from "@/shared/passes/predictor-core";
import { ObserverSite, PassPrediction, SatelliteRecord } from "@/shared/types";
import { satrecFromRecord } from "@/shared/propagation/engine";

let runtimePromise: ReturnType<typeof createSingleThreadRuntime> | null = null;

async function getRuntime() {
  if (!runtimePromise) {
    runtimePromise = createSingleThreadRuntime();
  }

  return runtimePromise;
}

export async function predictPassesBulkWasm(
  records: SatelliteRecord[],
  observer: ObserverSite,
  options: PassPredictOptions = {}
) {
  if (records.length <= 1) {
    return records.flatMap((record) => predictPassesForSatellite(record, observer, options));
  }

  const runtime = await getRuntime();
  const start = options.start ?? new Date();
  const end = options.end ?? new Date(start.getTime() + 2 * 86400000);
  const minElevationDeg = options.minElevationDeg ?? observer.minElevationDeg;
  const stepSeconds = options.stepSeconds ?? 60;
  const observerGeodetic = observerToGeodetic(observer);
  const satRecs = records.map((record) => satrecFromRecord(record));

  const dates: Date[] = [];
  for (let time = start.getTime(); time <= end.getTime(); time += stepSeconds * 1000) {
    dates.push(new Date(time));
  }

  using propagator = new BulkPropagator({
    runtime,
    calculators: [
      new EciBaseCalculator(),
      new GmstCalculator(),
      new EcfPositionCalculator(),
      new SunPositionCalculator(),
      new ShadowFractionCalculator(),
      new LookAnglesCalculator()
    ],
    satRecsCount: satRecs.length,
    datesCount: dates.length
  });

  propagator.setSatRecs(satRecs);
  propagator.setDates(dates);
  propagator.run({ lookAngles: { observer: observerGeodetic } });

  const allPasses: PassPrediction[] = [];

  records.forEach((record, satIndex) => {
    let inPass = false;
    let passStartIndex = -1;

    dates.forEach((date, dateIndex) => {
      const output = propagator.getFormattedOutput(satIndex, dateIndex);
      if (!output?.lookAngles) {
        return;
      }

      const elevationDeg = radiansToDegrees(output.lookAngles.elevation);
      const above = elevationDeg >= minElevationDeg;

      if (!inPass && above) {
        inPass = true;
        passStartIndex = dateIndex;
      }

      const isLast = dateIndex === dates.length - 1;
      if (inPass && (!above || isLast)) {
        const passStart = dates[Math.max(passStartIndex, 0)];
        const passEnd = date;
        const refined = predictPassesForSatellite(record, observer, {
          ...options,
          start: new Date(passStart.getTime() - stepSeconds * 1000),
          end: new Date(passEnd.getTime() + stepSeconds * 1000),
          stepSeconds: 20
        });

        allPasses.push(...refined);
        inPass = false;
        passStartIndex = -1;
      }
    });
  });

  return allPasses.sort((left, right) => left.aos.localeCompare(right.aos));
}
