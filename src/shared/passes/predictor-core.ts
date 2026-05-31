import { computeOrbitSnapshot, formatDopplerShift } from "@/shared/propagation/engine";
import { ObserverSite, PassPrediction, PassSample, SatelliteRecord } from "@/shared/types";

export interface PassPredictOptions {
  start?: Date;
  end?: Date;
  minElevationDeg?: number;
  stepSeconds?: number;
  downlinkHz?: number;
}

function elevationAt(record: SatelliteRecord, observer: ObserverSite, date: Date) {
  return computeOrbitSnapshot(record, date, observer).elevationDeg;
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
    const snapshot = computeOrbitSnapshot(record, new Date(time), observer);
    samples.push({
      timestamp: snapshot.timestamp,
      elevationDeg: snapshot.elevationDeg,
      azimuthDeg: snapshot.azimuthDeg,
      rangeKm: snapshot.rangeKm
    });
  }

  return samples;
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

  let inPass = false;
  let passStart: Date | null = null;

  const totalSteps = Math.ceil((end.getTime() - start.getTime()) / (stepSeconds * 1000));

  for (let index = 0; index <= totalSteps; index += 1) {
    const current = new Date(start.getTime() + index * stepSeconds * 1000);
    const next = new Date(current.getTime() + stepSeconds * 1000);
    const currentElevation = elevationAt(record, observer, current);
    const nextElevation = index === totalSteps ? -90 : elevationAt(record, observer, next);
    const currentlyAbove = currentElevation >= minElevationDeg;
    const nextAbove = nextElevation >= minElevationDeg;

    if (!inPass && currentlyAbove) {
      inPass = true;
      passStart = refineBoundary(
        record,
        observer,
        new Date(current.getTime() - stepSeconds * 1000),
        current,
        true,
        minElevationDeg
      );
    }

    if (inPass && passStart && !nextAbove) {
      const passEnd = refineBoundary(record, observer, current, next, false, minElevationDeg);
      const samples = buildSamples(record, observer, passStart, passEnd);
      const tcaSample = samples.reduce((best, sample) =>
        sample.elevationDeg > best.elevationDeg ? sample : best
      );
      const aosSnapshot = computeOrbitSnapshot(record, passStart, observer);
      const losSnapshot = computeOrbitSnapshot(record, passEnd, observer);
      const tcaSnapshot = computeOrbitSnapshot(record, new Date(tcaSample.timestamp), observer);

      passes.push({
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
        dopplerHzAtTca: formatDopplerShift(tcaSnapshot.dopplerFactor, options.downlinkHz),
        samples
      });

      inPass = false;
      passStart = null;
    }
  }

  return passes;
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
    "Illuminated",
    "DopplerHzAtTCA"
  ].join(",");

  const rows = passes.map((pass) =>
    [
      `"${pass.satelliteName}"`,
      pass.aos,
      pass.los,
      pass.tca,
      pass.maxElevationDeg.toFixed(2),
      pass.durationSec.toFixed(0),
      pass.aosAzimuthDeg.toFixed(2),
      pass.tcaAzimuthDeg.toFixed(2),
      pass.losAzimuthDeg.toFixed(2),
      pass.rangeKmAtTca.toFixed(2),
      pass.illuminated ? "yes" : "no",
      pass.dopplerHzAtTca?.toFixed(2) ?? ""
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
        `UID:${uid}`,
        `DTSTART:${pass.aos.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`,
        `DTEND:${pass.los.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`,
        `SUMMARY:${pass.satelliteName} pass over ${observerName}`,
        `DESCRIPTION:Max elevation ${pass.maxElevationDeg.toFixed(1)} deg`,
        "END:VEVENT"
      ].join("\r\n");
    })
    .join("\r\n");

  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sat Tracker//EN", events, "END:VCALENDAR"].join("\r\n");
}
