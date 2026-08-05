export interface TrackerMapLayers {
  tracks: boolean;
  footprints: boolean;
  labels: boolean;
  grid: boolean;
  sunMoon: boolean;
}

export interface PassOverlay {
  satelliteId: string;
  aos: string;
  los: string;
}

export const DEFAULT_MAP_LAYERS: TrackerMapLayers = {
  tracks: true,
  footprints: true,
  labels: true,
  grid: true,
  sunMoon: true
};

export const MAP_VIEWPORT_STORAGE_KEY = "sat-tracker.map-viewport";
export const MAP_LAYERS_STORAGE_KEY = "sat-tracker.map-layers";
export const MAP_FOLLOW_STORAGE_KEY = "sat-tracker.map-follow";

export function readStoredMapLayers(): TrackerMapLayers {
  try {
    const raw = JSON.parse(localStorage.getItem(MAP_LAYERS_STORAGE_KEY) ?? "{}") as Partial<TrackerMapLayers>;
    return {
      tracks: raw.tracks ?? DEFAULT_MAP_LAYERS.tracks,
      footprints: raw.footprints ?? DEFAULT_MAP_LAYERS.footprints,
      labels: raw.labels ?? DEFAULT_MAP_LAYERS.labels,
      grid: raw.grid ?? DEFAULT_MAP_LAYERS.grid,
      sunMoon: raw.sunMoon ?? DEFAULT_MAP_LAYERS.sunMoon
    };
  } catch {
    return { ...DEFAULT_MAP_LAYERS };
  }
}

export function writeStoredMapLayers(layers: TrackerMapLayers) {
  try {
    localStorage.setItem(MAP_LAYERS_STORAGE_KEY, JSON.stringify(layers));
  } catch {
    /* restricted environments */
  }
}

export function readStoredFollow(): boolean {
  try {
    return localStorage.getItem(MAP_FOLLOW_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeStoredFollow(follow: boolean) {
  try {
    localStorage.setItem(MAP_FOLLOW_STORAGE_KEY, follow ? "1" : "0");
  } catch {
    /* restricted environments */
  }
}
