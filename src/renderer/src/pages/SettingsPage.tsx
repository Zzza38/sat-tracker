import { useEffect, useRef, useState } from "react";
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

export function SettingsPage() {
  const { observer, settings, updateObserver, updateSettings, refreshCatalog } = useApp();
  const [draft, setDraft] = useState(observer);
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

  useEffect(() => {
    if (!observerDirtyRef.current) {
      setDraft(observer);
    }
  }, [observer]);

  useEffect(() => {
    if (!sourceUrlsDirtyRef.current) {
      setSourceUrls(settings.tleSources.map((source) => tleSourceUrl(source)).join("\n"));
    }
  }, [settings.tleSources]);

  useEffect(() => {
    setRefreshIntervalDraft(String(settings.refreshIntervalValue));
  }, [settings.refreshIntervalValue]);

  async function save() {
    const valid =
      draft.name.trim().length > 0 &&
      Number.isFinite(draft.latitude) &&
      draft.latitude >= -90 &&
      draft.latitude <= 90 &&
      Number.isFinite(draft.longitude) &&
      draft.longitude >= -180 &&
      draft.longitude <= 180 &&
      Number.isFinite(draft.altitudeM) &&
      Number.isFinite(draft.minElevationDeg) &&
      draft.minElevationDeg >= 0 &&
      draft.minElevationDeg <= 90;
    if (!valid) {
      setSavedIsError(true);
      setSaved("Enter valid observer coordinates and a 0-90° elevation mask.");
      return;
    }

    await updateObserver({
      ...draft,
      name: draft.name.trim(),
      minElevationDeg: clampMinimumElevation(draft.minElevationDeg)
    });
    observerDirtyRef.current = false;
    setSavedIsError(false);
    setSaved("Observer saved.");
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
                value={String(draft[key as keyof typeof draft] ?? "")}
                onChange={(event) =>
                  {
                    observerDirtyRef.current = true;
                    const value = key === "name" ? event.target.value : event.target.valueAsNumber;
                    if (key === "name" || Number.isFinite(value)) {
                      setDraft({
                        ...draft,
                        [key]: value
                      });
                    }
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
                  latitude: position.coords.latitude,
                  longitude: position.coords.longitude,
                  altitudeM: position.coords.altitude ?? current.altitudeM
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
