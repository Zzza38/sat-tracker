import { degreesLat, degreesLong, eciToGeodetic, gstime, jday, sunPos } from "satellite.js";

export interface LonLatPoint {
  latitudeDeg: number;
  longitudeDeg: number;
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function normalizeLongitude(longitudeDeg: number) {
  let longitude = ((longitudeDeg + 180) % 360 + 360) % 360 - 180;
  if (longitude === -180) {
    longitude = 180;
  }
  return longitude;
}

function daysSinceJ2000(date: Date) {
  return jday(date) - 2451545.0;
}

export function getSunSubpoint(date: Date): LonLatPoint {
  const geodetic = eciToGeodetic(sunPos(jday(date)).rsun, gstime(date));

  return {
    latitudeDeg: degreesLat(geodetic.latitude),
    longitudeDeg: degreesLong(geodetic.longitude)
  };
}

export function getMoonSubpoint(date: Date): LonLatPoint {
  const days = daysSinceJ2000(date);
  const meanLongitude = (218.316 + 13.176396 * days) * RAD;
  const meanAnomaly = (134.963 + 13.064993 * days) * RAD;
  const argumentLatitude = (93.272 + 13.22935 * days) * RAD;
  const eclipticLongitude = meanLongitude + 6.289 * RAD * Math.sin(meanAnomaly);
  const eclipticLatitude = 5.128 * RAD * Math.sin(argumentLatitude);
  const obliquity = (23.439 - 0.0000004 * days) * RAD;

  const rightAscension = Math.atan2(
    Math.sin(eclipticLongitude) * Math.cos(obliquity) -
      Math.tan(eclipticLatitude) * Math.sin(obliquity),
    Math.cos(eclipticLongitude)
  );
  const declination = Math.asin(
    Math.sin(eclipticLatitude) * Math.cos(obliquity) +
      Math.cos(eclipticLatitude) * Math.sin(obliquity) * Math.sin(eclipticLongitude)
  );
  const gmstDeg = gstime(date) * DEG;

  return {
    latitudeDeg: declination * DEG,
    longitudeDeg: normalizeLongitude(rightAscension * DEG - gmstDeg)
  };
}

export function destinationPoint(
  latitudeDeg: number,
  longitudeDeg: number,
  bearingDeg: number,
  distanceDeg: number
): LonLatPoint {
  const latitude = latitudeDeg * RAD;
  const longitude = longitudeDeg * RAD;
  const bearing = bearingDeg * RAD;
  const angularDistance = distanceDeg * RAD;

  const destinationLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const destinationLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude)
    );

  return {
    latitudeDeg: destinationLatitude * DEG,
    longitudeDeg: normalizeLongitude(destinationLongitude * DEG)
  };
}

export function getNightFootprint(date: Date, samples = 144) {
  const sun = getSunSubpoint(date);
  const antiSolarLatitude = -sun.latitudeDeg;
  const antiSolarLongitude = normalizeLongitude(sun.longitudeDeg + 180);

  return Array.from({ length: samples }, (_, index) =>
    destinationPoint(antiSolarLatitude, antiSolarLongitude, (index * 360) / samples, 90)
  );
}
