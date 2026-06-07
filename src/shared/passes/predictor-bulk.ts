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
const MAX_BULK_DATES = 10000;

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

  const start = options.start ?? new Date();
  const end = options.end ?? new Date(start.getTime() + 2 * 86400000);
  const minElevationDeg = options.minElevationDeg ?? observer.minElevationDeg;
  const requestedStepSeconds = options.stepSeconds ?? 60;
  if (!Number.isFinite(requestedStepSeconds) || requestedStepSeconds <= 0) {
    throw new Error("Pass prediction stepSeconds must be greater than zero.");
  }
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw new Error("Pass prediction end time must be after the start time.");
  }
  const durationSeconds = (end.getTime() - start.getTime()) / 1000;
  const stepSeconds = Math.max(requestedStepSeconds, Math.ceil(durationSeconds / MAX_BULK_DATES));
  const observerGeodetic = observerToGeodetic(observer);
  const validRecords = records.flatMap((record) => {
    try {
      return [{ record, satrec: satrecFromRecord(record) }];
    } catch {
      return [];
    }
  });
  if (validRecords.length === 0) {
    return [];
  }
  const runtime = await getRuntime();
  const satRecs = validRecords.map(({ satrec }) => satrec);

  const dates: Date[] = [];
  for (let time = start.getTime(); time <= end.getTime(); time += stepSeconds * 1000) {
    dates.push(new Date(time));
  }
  if (dates.at(-1)?.getTime() !== end.getTime()) {
    dates.push(end);
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

  validRecords.forEach(({ record }, satIndex) => {
    let inPass = false;
    let passStartIndex = -1;

    dates.forEach((date, dateIndex) => {
      const output = propagator.getFormattedOutput(satIndex, dateIndex);
      if (!output?.lookAngles) {
        inPass = false;
        passStartIndex = -1;
        return;
      }

      const elevationDeg = radiansToDegrees(output.lookAngles.elevation);
      const above = elevationDeg >= minElevationDeg;

      if (!inPass && above) {
        inPass = true;
        passStartIndex = dateIndex;
      }

      if (inPass && !above) {
        const passStart = dates[Math.max(passStartIndex, 0)];
        const passEnd = date;
        const refined = predictPassesForSatellite(record, observer, {
          ...options,
          start: new Date(passStart.getTime() - stepSeconds * 1000),
          end: new Date(passEnd.getTime() + stepSeconds * 1000),
          stepSeconds: 20
        });

        for (const pass of refined) {
          const duplicate = allPasses.some(
            (existing) =>
              existing.satelliteId === pass.satelliteId &&
              Math.abs(new Date(existing.aos).getTime() - new Date(pass.aos).getTime()) <
                stepSeconds * 1000
          );
          if (!duplicate) {
            allPasses.push(pass);
          }
        }
        inPass = false;
        passStartIndex = -1;
      }
    });
  });

  return allPasses.sort((left, right) => left.aos.localeCompare(right.aos));
}
