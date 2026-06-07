import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  addManualElements,
  addFromNoradId,
  addFromNoradIds,
  getWatchlistSatellites,
  importFromTleSource,
  listSatellites,
  refreshSatellite,
  toggleWatchlistSatellite
} from "@/shared/catalog/service";
import { db, ensureSeedData, getActiveObserver, getSettings, saveSettings } from "@/shared/db";
import { DEFAULT_OBSERVER } from "@/shared/observer/defaults";
import { DEFAULT_TLE_SOURCES, refreshIntervalToHours } from "@/shared/tle/sources";
import { resolveSatelliteColor } from "@/shared/satellite/colors";
import { ObserverSite, PassPrediction, SatelliteRecord } from "@/shared/types";

type Page = "catalog" | "tracker" | "passes" | "details" | "settings";

interface StoredUiState {
  page?: Page;
  selectedSatelliteId?: string | null;
  trackerViewMode?: "2d" | "3d";
}

interface TrackerPreviewRequest {
  satelliteId: string;
  startTime: string;
  requestId: number;
}

const UI_STORAGE_KEY = "sat-tracker-ui";

function readUiState(): StoredUiState {
  try {
    return JSON.parse(sessionStorage.getItem(UI_STORAGE_KEY) ?? "{}") as StoredUiState;
  } catch {
    return {};
  }
}

function writeUiState(partial: StoredUiState) {
  sessionStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ ...readUiState(), ...partial }));
}

function normalizePage(page: unknown): Page {
  return page === "catalog" || page === "tracker" || page === "passes" || page === "details" || page === "settings"
    ? page
    : "catalog";
}

interface AppContextValue {
  page: Page;
  setPage: (page: Page) => void;
  trackerViewMode: "2d" | "3d";
  setTrackerViewMode: (mode: "2d" | "3d") => void;
  satellites: SatelliteRecord[];
  watchlistIds: string[];
  selectedSatelliteId: string | null;
  selectedSatellite?: SatelliteRecord;
  observer: ObserverSite;
  settings: Awaited<ReturnType<typeof getSettings>>;
  passes: PassPrediction[];
  selectedPass: PassPrediction | null;
  trackerPreviewRequest: TrackerPreviewRequest | null;
  bootstrapping: boolean;
  error: string | null;
  clearError: () => void;
  refreshCatalog: (options?: { silent?: boolean }) => Promise<void>;
  selectSatellite: (id: string | null) => void;
  selectPass: (pass: PassPrediction | null) => void;
  previewPassOnTracker: (pass: PassPrediction) => void;
  addManualTle: (raw: string) => Promise<void>;
  addNorad: (noradId: string) => Promise<void>;
  addNoradBulk: (raw: string) => Promise<{
    added: SatelliteRecord[];
    failures: Array<{ id: string; error: string }>;
  }>;
  importTleSource: (sourceId: string) => Promise<void>;
  refreshSelectedSatellite: () => Promise<void>;
  toggleWatchlist: (satelliteId: string) => Promise<string[]>;
  updateObserver: (observer: ObserverSite) => Promise<void>;
  updateSettings: (partial: Partial<Awaited<ReturnType<typeof getSettings>>>) => Promise<void>;
  getSatelliteColor: (satelliteId: string, orderedIds: string[]) => string;
  setSatelliteColor: (satelliteId: string, color: string) => Promise<void>;
  setPasses: (passes: PassPrediction[]) => void;
}

const AppContext = createContext<AppContextValue | null>(null);
let seedPromise: Promise<void> | null = null;
let autoRefreshPromise: Promise<void> | null = null;

async function fetchInitialSources(appSettings: Awaited<ReturnType<typeof getSettings>>) {
  const results: PromiseSettledResult<{ source: (typeof appSettings.tleSources)[number]; importedCount: number }>[] =
    new Array(appSettings.tleSources.length);
  await Promise.all(
    Array.from({ length: Math.min(2, appSettings.tleSources.length) }, async (_, workerIndex) => {
      for (let index = workerIndex; index < appSettings.tleSources.length; index += 2) {
        const source = appSettings.tleSources[index];
        try {
          results[index] = {
            status: "fulfilled",
            value: { source, importedCount: await importFromTleSource(source) }
          };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    })
  );

  const importedAny = results.some(
    (result) => result.status === "fulfilled" && result.value.importedCount > 0
  );
  const failures = results.flatMap((result, index) =>
    result.status === "rejected" ? [appSettings.tleSources[index]?.name ?? "source"] : []
  );

  if (importedAny) {
    await saveSettings({ initialSourcesFetched: true, demoSeeded: true });
  }

  if (!importedAny && failures.length > 0) {
    throw new Error(`Could not import ${failures.join(", ")}.`);
  }
}

function catalogNeedsRefresh(
  records: SatelliteRecord[],
  appSettings: Awaited<ReturnType<typeof getSettings>>
) {
  if (records.length === 0 || appSettings.tleSources.length === 0) {
    return false;
  }

  const refreshMs =
    refreshIntervalToHours(appSettings.refreshIntervalValue, appSettings.refreshIntervalUnit) * 60 * 60 * 1000;
  const oldestFetch = Math.min(
    ...records.map((record) => new Date(record.fetchedAt).getTime()).filter(Number.isFinite)
  );

  return !Number.isFinite(oldestFetch) || Date.now() - oldestFetch >= refreshMs;
}

function chooseDefaultSatelliteId(records: SatelliteRecord[], watchlistIds: string[]) {
  const firstTracked = watchlistIds.find((id) => records.some((record) => record.id === id));
  if (firstTracked) {
    return firstTracked;
  }

  if (records.length === 0) {
    return null;
  }

  return records[Math.floor(Math.random() * records.length)]?.id ?? null;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const storedUi = readUiState();
  const [page, setPageState] = useState<Page>(normalizePage(storedUi.page));
  const [trackerViewMode, setTrackerViewModeState] = useState<"2d" | "3d">(
    storedUi.trackerViewMode ?? "2d"
  );
  const [satellites, setSatellites] = useState<SatelliteRecord[]>([]);
  const [watchlistIds, setWatchlistIds] = useState<string[]>([]);
  const [selectedSatelliteId, setSelectedSatelliteIdState] = useState<string | null>(
    storedUi.selectedSatelliteId ?? null
  );
  const [observer, setObserver] = useState<ObserverSite>(DEFAULT_OBSERVER);
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof getSettings>> | null>(null);
  const [passes, setPasses] = useState<PassPrediction[]>([]);
  const [selectedPass, setSelectedPass] = useState<PassPrediction | null>(null);
  const [trackerPreviewRequest, setTrackerPreviewRequest] = useState<TrackerPreviewRequest | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bootstrappedRef = useRef(false);

  const setPage = (nextPage: Page) => {
    setPageState(nextPage);
    writeUiState({ page: nextPage });
  };

  const setTrackerViewMode = (mode: "2d" | "3d") => {
    setTrackerViewModeState(mode);
    writeUiState({ trackerViewMode: mode });
  };

  const selectSatellite = (id: string | null) => {
    setSelectedSatelliteIdState(id);
    setSelectedPass(null);
    writeUiState({ selectedSatelliteId: id });
  };

  const previewPassOnTracker = (pass: PassPrediction) => {
    selectSatellite(pass.satelliteId);
    setSelectedPass(pass);
    setTrackerPreviewRequest({
      satelliteId: pass.satelliteId,
      startTime: pass.aos,
      requestId: Date.now()
    });
    setPage("tracker");
  };

  const refreshCatalog = async (options?: { silent?: boolean }) => {
    if (!options?.silent && !bootstrappedRef.current) {
      setBootstrapping(true);
    }
    setError(null);

    try {
      await ensureSeedData();
      let records = await listSatellites();
      const appSettings = await getSettings();
      let shouldRefreshInBackground = false;

      if (records.length === 0 && !appSettings.initialSourcesFetched) {
        if (!seedPromise) {
          seedPromise = fetchInitialSources(appSettings).finally(() => {
            seedPromise = null;
          });
        }
        await seedPromise;
        records = await listSatellites();
      } else if (catalogNeedsRefresh(records, appSettings)) {
        shouldRefreshInBackground = true;
      }

      const [activeObserver, nextSettings, watchlist] = await Promise.all([
        getActiveObserver(),
        getSettings(),
        db.watchlists.get("default")
      ]);

      setSatellites(records);
      setObserver(activeObserver);
      setSettings(nextSettings);
      setWatchlistIds(watchlist?.satelliteIds ?? []);

      setSelectedSatelliteIdState((current) => {
        let next: string | null;
        if (current && records.some((record) => record.id === current)) {
          next = current;
        } else {
          const restored = readUiState().selectedSatelliteId;
          if (restored && records.some((record) => record.id === restored)) {
            next = restored;
          } else {
            next = chooseDefaultSatelliteId(records, watchlist?.satelliteIds ?? []);
          }
        }
        writeUiState({ selectedSatelliteId: next });
        return next;
      });

      if (shouldRefreshInBackground && !autoRefreshPromise) {
        autoRefreshPromise = fetchInitialSources(appSettings)
          .then(async () => {
            const [freshRecords, freshSettings, freshWatchlist] = await Promise.all([
              listSatellites(),
              getSettings(),
              db.watchlists.get("default")
            ]);
            setSatellites(freshRecords);
            setSettings(freshSettings);
            setWatchlistIds(freshWatchlist?.satelliteIds ?? []);
            setSelectedSatelliteIdState((current) => {
              const next = current && freshRecords.some((record) => record.id === current)
                ? current
                : chooseDefaultSatelliteId(freshRecords, freshWatchlist?.satelliteIds ?? []);
              writeUiState({ selectedSatelliteId: next });
              return next;
            });
          })
          .catch(() => {
            // Cached data remains usable when a background catalog refresh fails.
          })
          .finally(() => {
            autoRefreshPromise = null;
          });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load catalog.");
    } finally {
      bootstrappedRef.current = true;
      setBootstrapping(false);
    }
  };

  useEffect(() => {
    void refreshCatalog();
  }, []);

  const selectedSatellite = useMemo(
    () => satellites.find((record) => record.id === selectedSatelliteId),
    [satellites, selectedSatelliteId]
  );

  async function ensureTracked(satelliteId: string) {
    const appSettings = await getSettings();
    if (!appSettings.trackOnAdd) {
      return;
    }

    const watchlist = await db.watchlists.get("default");
    if (watchlist?.satelliteIds.includes(satelliteId)) {
      return;
    }

    const ids = await toggleWatchlistSatellite("default", satelliteId);
    setWatchlistIds(ids);
  }

  const value = useMemo<AppContextValue>(() => ({
    page,
    setPage,
    trackerViewMode,
    setTrackerViewMode,
    satellites,
    watchlistIds,
    selectedSatelliteId,
    selectedSatellite,
    observer,
    settings: settings ?? {
      id: "app",
      refreshIntervalValue: 12,
      refreshIntervalUnit: "hours",
      tleSources: DEFAULT_TLE_SOURCES,
      defaultTleSourceId: "stations",
      trackOnAdd: false,
      satelliteColors: {},
      activeObserverId: DEFAULT_OBSERVER.id
    },
    passes,
    selectedPass,
    trackerPreviewRequest,
    bootstrapping,
    error,
    clearError: () => setError(null),
    refreshCatalog,
    selectSatellite,
    selectPass: setSelectedPass,
    previewPassOnTracker,
    addManualTle: async (raw) => {
      const record = await addManualElements(raw);
      await ensureTracked(record.id);
      await refreshCatalog({ silent: true });
      selectSatellite(record.id);
    },
    addNorad: async (noradId) => {
      const record = await addFromNoradId(noradId);
      await ensureTracked(record.id);
      await refreshCatalog({ silent: true });
      selectSatellite(record.id);
    },
    addNoradBulk: async (raw) => {
      const result = await addFromNoradIds(raw);
      for (const record of result.added) {
        await ensureTracked(record.id);
      }
      await refreshCatalog({ silent: true });
      selectSatellite(result.added[0]?.id ?? null);
      return result;
    },
    importTleSource: async (sourceId) => {
      const appSettings = await getSettings();
      const source = appSettings.tleSources.find((entry) => entry.id === sourceId);
      if (!source) {
        throw new Error("TLE source not found.");
      }

      await importFromTleSource(source);
      await refreshCatalog({ silent: true });
    },
    refreshSelectedSatellite: async () => {
      if (!selectedSatelliteId) {
        return;
      }
      await refreshSatellite(selectedSatelliteId);
      await refreshCatalog({ silent: true });
    },
    toggleWatchlist: async (satelliteId) => {
      const ids = await toggleWatchlistSatellite("default", satelliteId);
      setWatchlistIds(ids);
      return ids;
    },
    updateObserver: async (nextObserver) => {
      await db.observers.put(nextObserver);
      await saveSettings({ activeObserverId: nextObserver.id });
      setObserver(nextObserver);
    },
    updateSettings: async (partial) => {
      await saveSettings(partial);
      const next = await getSettings();
      setSettings(next);
    },
    getSatelliteColor: (satelliteId, orderedIds) => {
      const colors = settings?.satelliteColors ?? {};
      return resolveSatelliteColor(satelliteId, orderedIds, colors);
    },
    setSatelliteColor: async (satelliteId, color) => {
      const current = await getSettings();
      await saveSettings({
        satelliteColors: { ...current.satelliteColors, [satelliteId]: color }
      });
      const next = await getSettings();
      setSettings(next);
    },
    setPasses
  }), [
    bootstrapping,
    error,
    observer,
    page,
    passes,
    selectedPass,
    selectedSatellite,
    selectedSatelliteId,
    satellites,
    settings,
    trackerPreviewRequest,
    trackerViewMode,
    watchlistIds
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within AppProvider.");
  }

  return context;
}

export async function loadWatchlistSatellites() {
  return getWatchlistSatellites("default");
}
