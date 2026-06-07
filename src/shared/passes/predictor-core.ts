import { computeOrbitSnapshot } from "@/shared/propagation/engine";
import { ObserverSite, PassPrediction, PassSample, SatelliteRecord } from "@/shared/types";

export interface PassPredictOptions {
  start?: Date;
  end?: Date;
  minElevationDeg?: number;
  stepSeconds?: number;
}

function elevationAt(record: SatelliteRecord, observer: ObserverSite, date: Date) {
  return computeOrbitSnapshot(record, date, observer).elevationDeg;
}

function validateOptions(start: Date, end: Date, stepSeconds: number) {
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
    throw new Error("Pass prediction stepSeconds must be greater than zero.");
  }

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw new Error("Pass prediction end time must be after the start time.");
  }
}

function refineBoundary(
  record: SatelliteRecord,
  observer: ObserverSite,
  low: Date,
  high: Date,
  targetAbove: boolean,
  minElevationDeg: number
) {
  let left = low.getTime();
  let right = high.getTime();

  while (right - left > 1000) {
    const mid = new Date((left + right) / 2);
    const above = elevationAt(record, observer, mid) >= minElevationDeg;
    if (above === targetAbove) {
      right = mid.getTime();
    } else {
      left = mid.getTime();
    }
  }

  return new Date((left + right) / 2);
}

function buildSamples(
  record: SatelliteRecord,
  observer: ObserverSite,
  aos: Date,
  los: Date,
  sampleStepSeconds = 15
) {
  const samples: PassSample[] = [];
  for (let time = aos.getTime(); time <= los.getTime(); time += sampleStepSeconds * 1000) {
    try {
      const snapshot = computeOrbitSnapshot(record, new Date(time), observer);
      samples.push({
        timestamp: snapshot.timestamp,
        elevationDeg: snapshot.elevationDeg,
        azimuthDeg: snapshot.azimuthDeg,
        rangeKm: snapshot.rangeKm
      });
    } catch {
      // A decayed or otherwise invalid orbit should not fail every other pass.
    }
  }

  if (samples.at(-1)?.timestamp !== los.toISOString()) {
    try {
      const snapshot = computeOrbitSnapshot(record, los, observer);
      samples.push({
        timestamp: snapshot.timestamp,
        elevationDeg: snapshot.elevationDeg,
        azimuthDeg: snapshot.azimuthDeg,
        rangeKm: snapshot.rangeKm
      });
    } catch {
      // The caller will discard passes without usable samples.
    }
  }

  return samples;
}

function buildPass(
  record: SatelliteRecord,
  observer: ObserverSite,
  passStart: Date,
  passEnd: Date
): PassPrediction | null {
  const samples = buildSamples(record, observer, passStart, passEnd);
  if (samples.length === 0) {
    return null;
  }

  const tcaSample = samples.reduce(
    (best, sample) => (sample.elevationDeg > best.elevationDeg ? sample : best),
    samples[0]
  );

  try {
    const aosSnapshot = computeOrbitSnapshot(record, passStart, observer);
    const losSnapshot = computeOrbitSnapshot(record, passEnd, observer);
    const tcaSnapshot = computeOrbitSnapshot(record, new Date(tcaSample.timestamp), observer);

    return {
      satelliteId: record.id,
      satelliteName: record.name,
      aos: passStart.toISOString(),
      los: passEnd.toISOString(),
      tca: tcaSample.timestamp,
      maxElevationDeg: tcaSample.elevationDeg,
      durationSec: (passEnd.getTime() - passStart.getTime()) / 1000,
      aosAzimuthDeg: aosSnapshot.azimuthDeg,
      tcaAzimuthDeg: tcaSnapshot.azimuthDeg,
      losAzimuthDeg: losSnapshot.azimuthDeg,
      rangeKmAtTca: tcaSnapshot.rangeKm,
      illuminated: tcaSnapshot.sunlit,
      samples
    };
  } catch {
    return null;
  }
}

export function predictPassesForSatellite(
  record: SatelliteRecord,
  observer: ObserverSite,
  options: PassPredictOptions = {}
): PassPrediction[] {
  const start = options.start ?? new Date();
  const end = options.end ?? new Date(start.getTime() + 7 * 86400000);
  const minElevationDeg = options.minElevationDeg ?? observer.minElevationDeg;
  const stepSeconds = options.stepSeconds ?? 30;
  const passes: PassPrediction[] = [];
  validateOptions(start, end, stepSeconds);

  let previous = start;
  let previousElevation: number;
  try {
    previousElevation = elevationAt(record, observer, previous);
  } catch {
    return [];
  }

  let inPass = previousElevation >= minElevationDeg;
  let passStart: Date | null = inPass ? start : null;
  const stepMs = stepSeconds * 1000;

  for (let time = Math.min(start.getTime() + stepMs, end.getTime()); time <= end.getTime();) {
    const current = new Date(time);
    let currentElevation: number;
    try {
      currentElevation = elevationAt(record, observer, current);
    } catch {
      inPass = false;
      passStart = null;
      previous = current;
      previousElevation = Number.NEGATIVE_INFINITY;
      time = Math.min(time + stepMs, end.getTime());
      if (time === current.getTime()) {
        break;
      }
      continue;
    }

    const previousAbove = previousElevation >= minElevationDeg;
    const currentlyAbove = currentElevation >= minElevationDeg;

    if (!inPass && !previousAbove && currentlyAbove) {
      inPass = true;
      passStart = refineBoundary(record, observer, previous, current, true, minElevationDeg);
    } else if (inPass && passStart && previousAbove && !currentlyAbove) {
      const passEnd = refineBoundary(record, observer, previous, current, false, minElevationDeg);
      const pass = buildPass(record, observer, passStart, passEnd);
      if (pass) {
        passes.push(pass);
      }
      inPass = false;
      passStart = null;
    }

    previous = current;
    previousElevation = currentElevation;
    const nextTime = Math.min(time + stepMs, end.getTime());
    if (nextTime === time) {
      break;
    }
    time = nextTime;
  }

  return passes;
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function icsText(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r", "")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

export function passesToCsv(passes: PassPrediction[]) {
  const header = [
    "Satellite",
    "AOS",
    "LOS",
    "TCA",
    "MaxElevationDeg",
    "DurationSec",
    "AOSAzimuth",
    "TCAzimuth",
    "LOSAzimuth",
    "RangeKmAtTCA",
    "Illuminated"
  ].join(",");

  const rows = passes.map((pass) =>
    [
      csvCell(pass.satelliteName),
      pass.aos,
      pass.los,
      pass.tca,
      pass.maxElevationDeg.toFixed(2),
      pass.durationSec.toFixed(0),
      pass.aosAzimuthDeg.toFixed(2),
      pass.tcaAzimuthDeg.toFixed(2),
      pass.losAzimuthDeg.toFixed(2),
      pass.rangeKmAtTca.toFixed(2),
      pass.illuminated ? "yes" : "no"
    ].join(",")
  );

  return [header, ...rows].join("\n");
}

export function passesToIcs(passes: PassPrediction[], observerName: string) {
  const events = passes
    .map((pass) => {
      const uid = `${pass.satelliteId}-${pass.aos}`;
      return [
        "BEGIN:VEVENT",
        `UID:${icsText(uid)}`,
        `DTSTART:${pass.aos.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`,
        `DTEND:${pass.los.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`,
        `SUMMARY:${icsText(`${pass.satelliteName} pass over ${observerName}`)}`,
        `DESCRIPTION:Max elevation ${pass.maxElevationDeg.toFixed(1)} deg`,
        "END:VEVENT"
      ].join("\r\n");
    })
    .join("\r\n");

  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sat Tracker//EN", events, "END:VCALENDAR"].join("\r\n");
}
