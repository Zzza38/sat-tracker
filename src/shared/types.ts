export type ElementFormat = "tle" | "omm";
export type ElementSource = "manual" | "celestrak" | "seed";

export interface ObserverSite {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  altitudeM: number;
  minElevationDeg: number;
}

export interface FrequencyConfig {
  downlinkHz?: number;
  uplinkHz?: number;
}

export interface OmmElements {
  OBJECT_NAME?: string;
  OBJECT_ID?: string;
  NORAD_CAT_ID?: number | string;
  EPOCH?: string;
  MEAN_MOTION?: number | string;
  ECCENTRICITY?: number | string;
  INCLINATION?: number | string;
  RA_OF_ASC_NODE?: number | string;
  ARG_OF_PERICENTER?: number | string;
  MEAN_ANOMALY?: number | string;
  BSTAR?: number | string;
  REV_AT_EPOCH?: number | string;
  [key: string]: unknown;
}

export interface TleElements {
  name?: string;
  line1: string;
  line2: string;
}

export interface SatelliteRecord {
  id: string;
  noradId: string;
  name: string;
  internationalDesignator?: string;
  format: ElementFormat;
  source: ElementSource;
  fetchedAt: string;
  epoch?: string;
  tle?: TleElements;
  omm?: OmmElements;
  notes?: string;
  frequencies?: FrequencyConfig;
  tags?: string[];
}

export interface OrbitSnapshot {
  timestamp: string;
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
  velocityKmS: number;
  azimuthDeg: number;
  elevationDeg: number;
  rangeKm: number;
  dopplerFactor: number;
  sunlit: boolean;
  shadowFraction: number;
}

export interface GroundTrackPoint {
  latitudeDeg: number;
  longitudeDeg: number;
  timestamp: string;
  altitudeKm: number;
}

export interface PassPrediction {
  satelliteId: string;
  satelliteName: string;
  aos: string;
  los: string;
  tca: string;
  maxElevationDeg: number;
  durationSec: number;
  aosAzimuthDeg: number;
  tcaAzimuthDeg: number;
  losAzimuthDeg: number;
  rangeKmAtTca: number;
  illuminated: boolean;
  dopplerHzAtTca?: number;
  samples: PassSample[];
}

export interface PassSample {
  timestamp: string;
  elevationDeg: number;
  azimuthDeg: number;
  rangeKm: number;
}

export type RefreshIntervalUnit = "hours" | "days" | "weeks";
export type TleSourceEndpoint = "gp" | "supplemental" | "url";

export interface TleSource {
  id: string;
  name: string;
  endpoint: TleSourceEndpoint;
  group?: string;
  supplementalFile?: string;
  url?: string;
}

export interface AppSettings {
  refreshIntervalValue: number;
  refreshIntervalUnit: RefreshIntervalUnit;
  colorScheme: "dark";
  tleSources: TleSource[];
  defaultTleSourceId: string;
  trackOnAdd: boolean;
  satelliteColors: Record<string, string>;
}

export interface Watchlist {
  id: string;
  name: string;
  satelliteIds: string[];
}
