import {
  degreesLat,
  degreesLong,
  ecfToLookAngles,
  eciToEcf,
  eciToGeodetic,
  geodeticToEcf,
  gstime,
  json2satrec,
  propagate,
  shadowFraction,
  sunPos,
  twoline2satrec
} from "satellite.js";
import { observerToGeodetic, radiansToDegrees } from "@/shared/observer/defaults";
import { GroundTrackPoint, ObserverSite, OrbitSnapshot, SatelliteRecord } from "@/shared/types";

export function satrecFromRecord(record: SatelliteRecord) {
  if (record.format === "omm" && record.omm) {
    return json2satrec(record.omm);
  }

  if (record.tle) {
    return twoline2satrec(record.tle.line1, record.tle.line2);
  }

  throw new Error(`Satellite ${record.name} does not have usable orbital elements.`);
}

export function getOrbitMetrics(record: SatelliteRecord) {
  const satrec = satrecFromRecord(record);
  const meanMotionRadPerMin = satrec.no;
  const meanMotionRadPerSec = meanMotionRadPerMin / 60;
  const mu = 398600.4418;
  const semiMajorAxisKm = Math.cbrt(mu / (meanMotionRadPerSec ** 2));
  const eccentricity = satrec.ecco;
  const apogeeKm = semiMajorAxisKm * (1 + eccentricity) - 6378.137;
  const perigeeKm = semiMajorAxisKm * (1 - eccentricity) - 6378.137;
  const periodMin = (2 * Math.PI) / meanMotionRadPerMin;

  return {
    inclinationDeg: radiansToDegrees(satrec.inclo),
    eccentricity,
    periodMin,
    apogeeKm,
    perigeeKm
  };
}

export function computeOrbitSnapshot(record: SatelliteRecord, date: Date, observer: ObserverSite): OrbitSnapshot {
  const satrec = satrecFromRecord(record);
  const result = propagate(satrec, date);
  if (!result) {
    throw new Error(`Propagation failed for ${record.name}.`);
  }

  const gmst = gstime(date);
  const positionEci = result.position;
  const velocityEci = result.velocity;
  const positionEcf = eciToEcf(positionEci, gmst);
  const observerGeodetic = observerToGeodetic(observer);
  const lookAngles = ecfToLookAngles(observerGeodetic, positionEcf);
  const geodetic = eciToGeodetic(positionEci, gmst);
  const speed = Math.sqrt(velocityEci.x ** 2 + velocityEci.y ** 2 + velocityEci.z ** 2);
  const shadow = shadowFraction(sunPos(jday(date)).rsun, positionEci);

  return {
    timestamp: date.toISOString(),
    latitudeDeg: degreesLat(geodetic.latitude),
    longitudeDeg: degreesLong(geodetic.longitude),
    altitudeKm: geodetic.height,
    velocityKmS: speed,
    azimuthDeg: radiansToDegrees(lookAngles.azimuth),
    elevationDeg: radiansToDegrees(lookAngles.elevation),
    rangeKm: lookAngles.rangeSat,
    sunlit: shadow < 0.5,
    shadowFraction: shadow
  };
}

export function buildGroundTrack(
  record: SatelliteRecord,
  observer: ObserverSite,
  startDate = new Date(),
  points = 90,
  stepSeconds = 30
) {
  const track: GroundTrackPoint[] = [];

  for (let index = 0; index < points; index += 1) {
    const date = new Date(startDate.getTime() + index * stepSeconds * 1000);
    const snapshot = computeOrbitSnapshot(record, date, observer);
    track.push({
      latitudeDeg: snapshot.latitudeDeg,
      longitudeDeg: snapshot.longitudeDeg,
      altitudeKm: snapshot.altitudeKm,
      timestamp: snapshot.timestamp
    });
  }

  return track;
}

function jday(date: Date) {
  return (
    date.getTime() / 86400000 +
    2440587.5
  );
}
