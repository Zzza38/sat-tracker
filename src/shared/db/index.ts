import Dexie, { type Table } from "dexie";
import { DEFAULT_OBSERVER } from "@/shared/observer/defaults";
import { DEFAULT_TLE_SOURCES } from "@/shared/tle/sources";
import {
  AppSettings,
  ObserverSite,
  PassPrediction,
  SatelliteRecord,
  Watchlist
} from "@/shared/types";

export interface PassCacheEntry {
  id: string;
  observerId: string;
  satelliteId: string;
  windowStart: string;
  windowEnd: string;
  computedAt: string;
  passes: PassPrediction[];
}

export interface SettingsRow extends AppSettings {
  id: "app";
  activeObserverId: string;
  demoSeeded?: boolean;
  initialSourcesFetched?: boolean;
}

const DEFAULT_SETTINGS: SettingsRow = {
  id: "app",
  refreshIntervalValue: 12,
  refreshIntervalUnit: "hours",
  colorScheme: "dark",
  tleSources: DEFAULT_TLE_SOURCES,
  defaultTleSourceId: "stations",
  trackOnAdd: false,
  satelliteColors: {},
  activeObserverId: DEFAULT_OBSERVER.id
};

interface LegacySettingsRow {
  refreshIntervalHours?: number;
  defaultGroup?: string;
}

function migrateSettings(settings: SettingsRow & LegacySettingsRow): SettingsRow {
  const next = { ...settings };

  if (next.refreshIntervalValue === undefined && next.refreshIntervalHours !== undefined) {
    next.refreshIntervalValue = next.refreshIntervalHours;
    next.refreshIntervalUnit = "hours";
  }

  if (!next.tleSources?.length) {
    next.tleSources = DEFAULT_TLE_SOURCES;
  }

  if (!next.defaultTleSourceId) {
    const legacyGroup = next.defaultGroup;
    const matched = legacyGroup ? next.tleSources.find((source) => source.group === legacyGroup) : undefined;
    next.defaultTleSourceId = matched?.id ?? next.tleSources[0]?.id ?? "stations";
  }

  if (next.trackOnAdd === undefined) {
    next.trackOnAdd = false;
  }

  if (!next.satelliteColors) {
    next.satelliteColors = {};
  }

  return next;
}

export class SatTrackerDb extends Dexie {
  satellites!: Table<SatelliteRecord, string>;
  watchlists!: Table<Watchlist, string>;
  observers!: Table<ObserverSite, string>;
  settings!: Table<SettingsRow, "app">;
  passCache!: Table<PassCacheEntry, string>;

  constructor() {
    super("sat-tracker");

    this.version(1).stores({
      satellites: "id, noradId, name, fetchedAt",
      watchlists: "id, name",
      observers: "id, name",
      settings: "id",
      passCache: "id, observerId, satelliteId, computedAt"
    });
  }
}

export const db = new SatTrackerDb();

export async function ensureSeedData() {
  const observerCount = await db.observers.count();
  if (observerCount === 0) {
    await db.observers.add(DEFAULT_OBSERVER);
  }

  const settings = await db.settings.get("app");
  if (!settings) {
    await db.settings.add(DEFAULT_SETTINGS);
  } else {
    const migrated = migrateSettings(settings);
    if (JSON.stringify(migrated) !== JSON.stringify(settings)) {
      await db.settings.put(migrated);
    }
  }

  const watchlistCount = await db.watchlists.count();
  if (watchlistCount === 0) {
    await db.watchlists.add({
      id: "default",
      name: "Watchlist",
      satelliteIds: []
    });
  }
}

export async function getSettings() {
  await ensureSeedData();
  const settings = await db.settings.get("app");
  return migrateSettings(settings ?? DEFAULT_SETTINGS);
}

export async function saveSettings(settings: Partial<SettingsRow>) {
  const current = await getSettings();
  await db.settings.put({ ...current, ...settings });
}

export async function getActiveObserver() {
  const settings = await getSettings();
  const observer = await db.observers.get(settings.activeObserverId);
  return observer ?? DEFAULT_OBSERVER;
}
