import { useEffect, useMemo, useRef, useState } from "react";
import {
  createUrlTleSource,
  refreshIntervalToHours,
  tleSourceUrl
} from "@/shared/tle/sources";
import { RefreshIntervalUnit, TleSource } from "@/shared/types";
import { importFromTleSource } from "@/shared/catalog/service";
import { useApp } from "../context/AppContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/select";
import { Button } from "../components/ui/button";
import { Slider } from "../components/ui/slider";
import { Switch } from "../components/ui/switch";

function clampMinimumElevation(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(90, Math.max(0, value));
}

const CITY_PRESETS = [
  { id: "new-york", name: "New York, NY", latitude: 40.7128, longitude: -74.006, altitudeM: 10 },
  { id: "los-angeles", name: "Los Angeles, CA", latitude: 34.0522, longitude: -118.2437, altitudeM: 89 },
  { id: "chicago", name: "Chicago, IL", latitude: 41.8781, longitude: -87.6298, altitudeM: 181 },
  { id: "houston", name: "Houston, TX", latitude: 29.7604, longitude: -95.3698, altitudeM: 13 },
  { id: "phoenix", name: "Phoenix, AZ", latitude: 33.4484, longitude: -112.074, altitudeM: 331 },
  { id: "philadelphia", name: "Philadelphia, PA", latitude: 39.9526, longitude: -75.1652, altitudeM: 12 },
  { id: "san-antonio", name: "San Antonio, TX", latitude: 29.4241, longitude: -98.4936, altitudeM: 198 },
  { id: "san-diego", name: "San Diego, CA", latitude: 32.7157, longitude: -117.1611, altitudeM: 19 },
  { id: "dallas", name: "Dallas, TX", latitude: 32.7767, longitude: -96.797, altitudeM: 131 },
  { id: "san-jose", name: "San Jose, CA", latitude: 37.3382, longitude: -121.8863, altitudeM: 26 },
  { id: "seattle", name: "Seattle, WA", latitude: 47.6062, longitude: -122.3321, altitudeM: 52 },
  { id: "denver", name: "Denver, CO", latitude: 39.7392, longitude: -104.9903, altitudeM: 1609 },
  { id: "miami", name: "Miami, FL", latitude: 25.7617, longitude: -80.1918, altitudeM: 2 },
  { id: "washington-dc", name: "Washington, DC", latitude: 38.9072, longitude: -77.0369, altitudeM: 7 },
  { id: "london", name: "London, UK", latitude: 51.5074, longitude: -0.1278, altitudeM: 10 },
  { id: "paris", name: "Paris, France", latitude: 48.8566, longitude: 2.3522, altitudeM: 35 },
  { id: "tokyo", name: "Tokyo, Japan", latitude: 35.6762, longitude: 139.6503, altitudeM: 40 },
  { id: "sydney", name: "Sydney, Australia", latitude: -33.8688, longitude: 151.2093, altitudeM: 58 },
  { id: "toronto", name: "Toronto, Canada", latitude: 43.6532, longitude: -79.3832, altitudeM: 76 },
  { id: "mexico-city", name: "Mexico City, Mexico", latitude: 19.4326, longitude: -99.1332, altitudeM: 2240 }
] as const;

type ObserverDraft = {
  id: string;
  name: string;
  latitude: string;
  longitude: string;
  altitudeM: string;
  minElevationDeg: number;
};

function observerToDraft(observer: {
  id?: string;
  name: string;
  latitude: number;
  longitude: number;
  altitudeM: number;
  minElevationDeg?: number;
}): ObserverDraft {
  return {
    id: observer.id ?? `observer-${Date.now()}`,
    name: observer.name,
    latitude: String(observer.latitude),
    longitude: String(observer.longitude),
    altitudeM: String(observer.altitudeM),
    minElevationDeg: clampMinimumElevation(observer.minElevationDeg ?? 10)
  };
}

function parseObserverDraft(draft: ObserverDraft) {
  const latitude = Number(draft.latitude);
  const longitude = Number(draft.longitude);
  const altitudeM = Number(draft.altitudeM);
  const errors: string[] = [];

  if (draft.name.trim().length === 0) {
    errors.push("Name is required.");
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    errors.push("Latitude must be between -90 and 90.");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    errors.push("Longitude must be between -180 and 180.");
  }
  if (!Number.isFinite(altitudeM)) {
    errors.push("Altitude must be a number.");
  }

  return {
    errors,
    observer: {
      id: draft.id,
      name: draft.name.trim(),
      latitude,
      longitude,
      altitudeM,
      minElevationDeg: clampMinimumElevation(draft.minElevationDeg)
    }
  };
}

export function SettingsPage() {
  const {
    observer,
    observers,
    activeObserverId,
    settings,
    selectObserver,
    updateObserver,
    updateSettings,
    refreshCatalog
  } = useApp();
  const [draft, setDraft] = useState<ObserverDraft>(() => observerToDraft(observer));
  const [saved, setSaved] = useState<string | null>(null);
  const [savedIsError, setSavedIsError] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importStatusIsError, setImportStatusIsError] = useState(false);
  const [importingAll, setImportingAll] = useState(false);
  const observerDirtyRef = useRef(false);
  const sourceUrlsDirtyRef = useRef(false);
  const [refreshIntervalDraft, setRefreshIntervalDraft] = useState(String(settings.refreshIntervalValue));
  const [sourceUrls, setSourceUrls] = useState(() =>
    settings.tleSources.map((source) => tleSourceUrl(source)).join("\n")
  );
  const observerValidation = useMemo(() => parseObserverDraft(draft), [draft]);

  useEffect(() => {
    if (!observerDirtyRef.current) {
      setDraft(observerToDraft(observer));
    }
  }, [observer]);

  useEffect(() => {
    if (!observerDirtyRef.current) {
      return;
    }

    if (observerValidation.errors.length > 0) {
      setSavedIsError(true);
      setSaved(observerValidation.errors[0]);
      return;
    }

    const timeout = window.setTimeout(() => {
      void updateObserver(observerValidation.observer).then(() => {
        observerDirtyRef.current = false;
        setSavedIsError(false);
        setSaved("Observer saved.");
      });
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [observerValidation, updateObserver]);

  useEffect(() => {
    if (!sourceUrlsDirtyRef.current) {
      setSourceUrls(settings.tleSources.map((source) => tleSourceUrl(source)).join("\n"));
    }
  }, [settings.tleSources]);

  useEffect(() => {
    setRefreshIntervalDraft(String(settings.refreshIntervalValue));
  }, [settings.refreshIntervalValue]);

  async function save() {
    if (observerValidation.errors.length > 0) {
      setSavedIsError(true);
      setSaved(observerValidation.errors[0]);
      return;
    }

    await updateObserver(observerValidation.observer);
    observerDirtyRef.current = false;
    setSavedIsError(false);
    setSaved("Observer saved.");
  }

  async function chooseCityPreset(presetId: string) {
    const preset = CITY_PRESETS.find((city) => city.id === presetId);
    if (!preset) {
      return;
    }

    observerDirtyRef.current = false;
    const nextObserver = {
      ...preset,
      minElevationDeg: draft.minElevationDeg
    };
    setDraft(observerToDraft(nextObserver));
    await updateObserver(nextObserver);
    setSavedIsError(false);
    setSaved(`Observer set to ${preset.name}.`);
  }

  async function createObserver() {
    const nextObserver = {
      ...observer,
      id: `observer-${Date.now().toString(36)}`,
      name: "New observer"
    };
    observerDirtyRef.current = false;
    setDraft(observerToDraft(nextObserver));
    await updateObserver(nextObserver);
    setSavedIsError(false);
    setSaved("New observer created.");
  }

  async function updateTleSources(nextSources: TleSource[]) {
    await updateSettings({
      tleSources: nextSources,
      defaultTleSourceId: nextSources[0]?.id ?? settings.defaultTleSourceId
    });
  }

  async function saveSourceUrls() {
    await updateTleSources(buildSourcesFromText());
    sourceUrlsDirtyRef.current = false;
    setImportStatusIsError(false);
    setImportStatus("Sources saved.");
  }

  function parseSourceUrls(raw: string) {
    return raw
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function buildSourcesFromText() {
    return parseSourceUrls(sourceUrls).map((url) => {
      const existing = settings.tleSources.find((source) => tleSourceUrl(source) === url);
      return existing ?? createUrlTleSource(url);
    });
  }

  async function importAllSources() {
    setImportStatus(null);
    setImportingAll(true);
    try {
      const sources = buildSourcesFromText();
      await updateTleSources(sources);
      let failures = 0;
      await Promise.all(
        Array.from({ length: Math.min(2, sources.length) }, async (_, workerIndex) => {
          for (let index = workerIndex; index < sources.length; index += 2) {
            try {
              await importFromTleSource(sources[index]);
            } catch {
              failures += 1;
            }
          }
        })
      );
      if (failures < sources.length) {
        await refreshCatalog({ silent: true });
      }
      if (failures > 0) {
        setImportStatusIsError(true);
        setImportStatus(`${sources.length - failures} sources updated, ${failures} failed.`);
      } else {
        setImportStatusIsError(false);
        setImportStatus("All sources updated.");
      }
    } finally {
      setImportingAll(false);
    }
  }

  async function saveRefreshInterval() {
    const value = Number(refreshIntervalDraft);
    if (!Number.isFinite(value) || value < 1) {
      setRefreshIntervalDraft(String(settings.refreshIntervalValue));
      return;
    }
    await updateSettings({ refreshIntervalValue: value });
  }

  const staleAfterHours = refreshIntervalToHours(
    settings.refreshIntervalValue,
    settings.refreshIntervalUnit
  );
  const sourceUrlCount = parseSourceUrls(sourceUrls).length;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[380px_1fr]">
      <section className="panel h-fit self-start p-5">
        <p className="label">Ground station</p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-[var(--text)]">Observer settings</h1>

        <div className="mt-6 space-y-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--faint)]">Active observer</span>
              <Select
                value={activeObserverId}
                onValueChange={(observerId) => {
                  observerDirtyRef.current = false;
                  setSaved(null);
                  void selectObserver(observerId);
                }}
              >
                <SelectTrigger className="h-[42px] w-full border-[var(--line-strong)] bg-[var(--bg)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {observers.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <Button className="self-end" variant="secondary" onClick={() => void createObserver()}>
              New
            </Button>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[var(--faint)]">City or town preset</span>
            <Select onValueChange={(presetId) => void chooseCityPreset(presetId)}>
              <SelectTrigger className="h-[42px] border-[var(--line-strong)] bg-[var(--bg)]">
                <SelectValue placeholder="Choose a preset..." />
              </SelectTrigger>
              <SelectContent>
                {CITY_PRESETS.map((city) => (
                  <SelectItem key={city.id} value={city.id}>
                    {city.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {[
            ["name", "Site name"],
            ["latitude", "Latitude"],
            ["longitude", "Longitude"],
            ["altitudeM", "Altitude (m)"]
          ].map(([key, label]) => (
            <label key={key} className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--faint)]">{label}</span>
              <input
                type={key === "name" ? "text" : "number"}
                value={draft[key as keyof ObserverDraft] as string}
                onChange={(event) =>
                  {
                    observerDirtyRef.current = true;
                    setSaved(null);
                    setDraft({
                      ...draft,
                      [key]: event.target.value
                    });
                  }
                }
              />
            </label>
          ))}

          <label className="block space-y-2">
            <span className="flex items-center justify-between gap-3 text-xs font-medium text-[var(--faint)]">
              <span>Minimum elevation</span>
              <span className="mono text-[var(--text)]">{clampMinimumElevation(draft.minElevationDeg).toFixed(0)}°</span>
            </span>
            <div className="rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-3 py-3">
              <Slider
                min={0}
                max={90}
                step={1}
                value={[clampMinimumElevation(draft.minElevationDeg)]}
                aria-label="Minimum elevation"
                onValueChange={([value]) => {
                  observerDirtyRef.current = true;
                  setSaved(null);
                  setDraft((current) => ({
                    ...current,
                    minElevationDeg: clampMinimumElevation(value ?? 0)
                  }));
                }}
              />
              <div className="mono mt-2 flex justify-between text-[11px] text-[var(--faint)]">
                <span>0°</span>
                <span>90°</span>
              </div>
            </div>
          </label>
        </div>

        <div className="mt-5 flex gap-2">
          <Button className="w-[132px]" onClick={() => void save()}>
            Save Observer
          </Button>
          <Button
            className="w-[180px]"
            variant="secondary"
            onClick={() => {
              navigator.geolocation.getCurrentPosition((position) => {
                observerDirtyRef.current = true;
                setSaved(null);
                setDraft((current) => ({
                  ...current,
                  latitude: String(position.coords.latitude),
                  longitude: String(position.coords.longitude),
                  altitudeM: String(position.coords.altitude ?? current.altitudeM)
                }));
              }, (error) => {
                setSavedIsError(true);
                setSaved(error.message || "Browser location permission was denied.");
              });
            }}
          >
            Use browser location
          </Button>
        </div>

        {saved ? <p className={`mono mt-4 text-sm ${savedIsError ? "text-[var(--danger)]" : "text-[var(--accent)]"}`}>{saved}</p> : null}
      </section>

      <div className="space-y-6">
        <section className="panel p-5">
          <p className="label">Data refresh</p>
          <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-[var(--text)]">Catalog preferences</h2>

          <div className="mt-6 grid gap-4 md:grid-cols-[1fr_160px]">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--faint)]">Automatically refresh every</span>
              <input
                type="number"
                min={1}
                value={refreshIntervalDraft}
                onChange={(event) => setRefreshIntervalDraft(event.target.value)}
                onBlur={() => void saveRefreshInterval()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--faint)]">Unit</span>
              <Select
                value={settings.refreshIntervalUnit}
                onValueChange={(value) =>
                  void updateSettings({ refreshIntervalUnit: value as RefreshIntervalUnit })
                }
              >
                <SelectTrigger className="h-[42px] border-[var(--line-strong)] bg-[var(--bg)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hours">Hours</SelectItem>
                  <SelectItem value="days">Days</SelectItem>
                  <SelectItem value="weeks">Weeks</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>

          <p className="mt-3 text-sm text-[var(--muted)]">
            The catalog refreshes from all configured sources when local TLE data is older than{" "}
            {settings.refreshIntervalValue} {settings.refreshIntervalUnit} ({staleAfterHours} hours).
          </p>
        </section>

        <section className="panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="label">TLE sources</p>
              <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-[var(--text)]">Fetch sources</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Add TLE or OMM JSON feed URLs. Updates fetch every source together.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex h-9 items-center gap-2 rounded-md border border-[var(--line-strong)] bg-[var(--surface-2)] px-3 text-sm font-medium text-[var(--text)]">
                <Switch
                  checked={settings.trackOnAdd}
                  onCheckedChange={(checked) => void updateSettings({ trackOnAdd: checked })}
                  size="sm"
                />
                Auto-track new satellites
              </label>
              <Button
                className="w-[116px]"
                variant="secondary"
                size="sm"
                disabled={importingAll || sourceUrlCount === 0}
                onClick={() => void importAllSources()}
              >
                {importingAll ? "Updating..." : "Update all"}
              </Button>
            </div>
          </div>

          {importStatus ? <p className={`mono mt-3 text-sm ${importStatusIsError ? "text-[var(--danger)]" : "text-[var(--accent)]"}`}>{importStatus}</p> : null}

          <div className="mt-6">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--faint)]">One URL per line</span>
              <textarea
                className="mono min-h-[280px] resize-y text-xs leading-relaxed"
                value={sourceUrls}
                onChange={(event) => {
                  sourceUrlsDirtyRef.current = true;
                  setSourceUrls(event.target.value);
                }}
                placeholder={`https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=JSON
https://example.com/catalog.tle`}
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void saveSourceUrls()}>
                Save sources
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  sourceUrlsDirtyRef.current = false;
                  setSourceUrls(settings.tleSources.map((source) => tleSourceUrl(source)).join("\n"));
                }}
              >
                Revert
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
