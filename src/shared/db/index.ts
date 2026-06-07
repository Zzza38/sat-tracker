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
let seedDataPromise: Promise<void> | null = null;

export async function ensureSeedData() {
  if (!seedDataPromise) {
    seedDataPromise = db.transaction(
      "rw",
      db.observers,
      db.settings,
      db.watchlists,
      async () => {
        const observerCount = await db.observers.count();
        if (observerCount === 0) {
          await db.observers.put(DEFAULT_OBSERVER);
        }

        const settings = await db.settings.get("app");
        if (!settings) {
          await db.settings.put(DEFAULT_SETTINGS);
        } else {
          const migrated = migrateSettings(settings);
          if (JSON.stringify(migrated) !== JSON.stringify(settings)) {
            await db.settings.put(migrated);
          }
        }

        const watchlistCount = await db.watchlists.count();
        if (watchlistCount === 0) {
          await db.watchlists.put({
            id: "default",
            name: "Watchlist",
            satelliteIds: []
          });
        }
      }
    ).finally(() => {
      seedDataPromise = null;
    });
  }

  await seedDataPromise;
}

export async function getSettings() {
  await ensureSeedData();
  const settings = await db.settings.get("app");
  return migrateSettings(settings ?? DEFAULT_SETTINGS);
}

export async function saveSettings(settings: Partial<SettingsRow>) {
  await ensureSeedData();
  const updated = await db.settings.update("app", settings);
  if (updated === 0) {
    await db.settings.put({ ...DEFAULT_SETTINGS, ...settings });
  }
}

export async function getActiveObserver() {
  const settings = await getSettings();
  const observer = await db.observers.get(settings.activeObserverId);
  if (observer) {
    return observer;
  }

  await db.observers.put(DEFAULT_OBSERVER);
  if (settings.activeObserverId !== DEFAULT_OBSERVER.id) {
    await saveSettings({ activeObserverId: DEFAULT_OBSERVER.id });
  }
  return DEFAULT_OBSERVER;
}
