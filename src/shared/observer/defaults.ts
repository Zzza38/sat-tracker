import { ObserverSite } from "@/shared/types";

export const DEFAULT_OBSERVER: ObserverSite = {
  id: "home",
  name: "London Station",
  latitude: 51.5074,
  longitude: -0.1278,
  altitudeM: 10,
  minElevationDeg: 10
};

export function observerToGeodetic(observer: ObserverSite) {
  return {
    latitude: degreesToRadians(observer.latitude),
    longitude: degreesToRadians(observer.longitude),
    height: observer.altitudeM / 1000
  };
}

export function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

export function radiansToDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}
