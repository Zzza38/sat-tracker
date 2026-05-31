import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createTleSourceId, refreshIntervalToHours } from "@/shared/tle/sources";
import { RefreshIntervalUnit, TleSource, TleSourceEndpoint } from "@/shared/types";
import { useApp } from "../context/AppContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/select";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";

export function SettingsPage() {
  const { observer, settings, updateObserver, updateSettings, importTleSource } = useApp();
  const [draft, setDraft] = useState(observer);
  const [saved, setSaved] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importingSourceId, setImportingSourceId] = useState<string | null>(null);
  const [newSource, setNewSource] = useState({
    name: "",
    endpoint: "gp" as TleSourceEndpoint,
    group: "",
    supplementalFile: "",
    url: ""
  });

  async function save() {
    await updateObserver(draft);
    setSaved("Observer saved.");
  }

  function updateTleSources(nextSources: TleSource[]) {
    const nextDefault = nextSources.some((source) => source.id === settings.defaultTleSourceId)
      ? settings.defaultTleSourceId
      : nextSources[0]?.id ?? settings.defaultTleSourceId;

    void updateSettings({
      tleSources: nextSources,
      defaultTleSourceId: nextDefault
    });
  }

  function addSource() {
    const name = newSource.name.trim();
    if (!name) {
      return;
    }

    const source: TleSource = {
      id: createTleSourceId(),
      name,
      endpoint: newSource.endpoint,
      group: newSource.endpoint === "gp" ? newSource.group.trim() || undefined : undefined,
      supplementalFile:
        newSource.endpoint === "supplemental" ? newSource.supplementalFile.trim() || undefined : undefined,
      url: newSource.endpoint === "url" ? newSource.url.trim() || undefined : undefined
    };

    updateTleSources([...settings.tleSources, source]);
    setNewSource({ name: "", endpoint: "gp", group: "", supplementalFile: "", url: "" });
  }

  function removeSource(id: string) {
    updateTleSources(settings.tleSources.filter((source) => source.id !== id));
  }

  async function importSource(id: string) {
    setImportStatus(null);
    setImportingSourceId(id);
    try {
      await importTleSource(id);
      setImportStatus("Update complete.");
    } catch (caught) {
      setImportStatus(caught instanceof Error ? caught.message : "Update failed.");
    } finally {
      setImportingSourceId(null);
    }
  }

  const staleAfterHours = refreshIntervalToHours(
    settings.refreshIntervalValue,
    settings.refreshIntervalUnit
  );

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
            ["altitudeM", "Altitude (m)"],
            ["minElevationDeg", "Minimum elevation (deg)"]
          ].map(([key, label]) => (
            <label key={key} className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--faint)]">{label}</span>
              <input
                value={String(draft[key as keyof typeof draft] ?? "")}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    [key]:
                      key === "name"
                        ? event.target.value
                        : Number(event.target.value)
                  })
                }
              />
            </label>
          ))}
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
                setDraft((current) => ({
                  ...current,
                  latitude: position.coords.latitude,
                  longitude: position.coords.longitude,
                  altitudeM: position.coords.altitude ?? current.altitudeM
                }));
              });
            }}
          >
            Use browser location
          </Button>
        </div>

        {saved ? <p className="mono mt-4 text-sm text-[var(--accent)]">{saved}</p> : null}
      </section>

      <div className="space-y-6">
        <section className="panel p-5">
          <p className="label">Data refresh</p>
          <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-[var(--text)]">Catalog preferences</h2>

          <div className="mt-6 grid gap-4 md:grid-cols-[1fr_160px]">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--faint)]">Mark stale after</span>
              <input
                type="number"
                min={1}
                value={settings.refreshIntervalValue}
                onChange={(event) =>
                  void updateSettings({ refreshIntervalValue: Number(event.target.value) })
                }
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
            Satellites older than {settings.refreshIntervalValue} {settings.refreshIntervalUnit} (
            {staleAfterHours} hours) are marked stale.
          </p>
        </section>

        <section className="panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="label">TLE sources</p>
              <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-[var(--text)]">Fetch sources</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Manage CelesTrak groups and supplemental feeds. Update from here to populate the catalog.
              </p>
            </div>
            <label className="flex h-9 items-center gap-2 rounded-md border border-[var(--line-strong)] bg-[var(--surface-2)] px-3 text-sm font-medium text-[var(--text)]">
              <Switch
                checked={settings.trackOnAdd}
                onCheckedChange={(checked) => void updateSettings({ trackOnAdd: checked })}
                size="sm"
              />
              Auto-track new satellites
            </label>
          </div>

          <div className="mt-5 space-y-3">
            {settings.tleSources.map((source) => (
              <div
                key={source.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3"
              >
                <div>
                  <div className="font-medium text-[var(--text)]">{source.name}</div>
                  <div className="mono mt-1 text-xs text-[var(--faint)]">
                    {source.endpoint === "gp"
                      ? `GP group: ${source.group ?? "unset"}`
                      : source.endpoint === "supplemental"
                        ? `Supplemental: ${source.supplementalFile ?? "unset"}`
                        : `URL: ${source.url ?? "unset"}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    className="w-[96px]"
                    variant="secondary"
                    size="sm"
                    disabled={importingSourceId === source.id}
                    onClick={() => void importSource(source.id)}
                  >
                    Update
                  </Button>
                  <Button
                    className="w-[132px]"
                    variant={settings.defaultTleSourceId === source.id ? "default" : "secondary"}
                    size="sm"
                    onClick={() => void updateSettings({ defaultTleSourceId: source.id })}
                  >
                    {settings.defaultTleSourceId === source.id ? "Default" : "Make default"}
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => removeSource(source.id)} aria-label={`Remove ${source.name}`}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            ))}

            {settings.tleSources.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No sources configured. Add one below.</p>
            ) : null}
          </div>

          {importStatus ? <p className="mono mt-3 text-sm text-[var(--accent)]">{importStatus}</p> : null}

          <div className="mt-6 rounded-[10px] border border-[var(--line)] p-4">
            <p className="text-sm font-medium text-[var(--text)]">Add source</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block space-y-1.5 md:col-span-2">
                <span className="text-xs font-medium text-[var(--faint)]">Display name</span>
                <input
                  value={newSource.name}
                  onChange={(event) => setNewSource({ ...newSource, name: event.target.value })}
                  placeholder="My custom group"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[var(--faint)]">Endpoint</span>
                <Select
                  value={newSource.endpoint}
                  onValueChange={(value) =>
                    setNewSource({
                      ...newSource,
                      endpoint: value as TleSourceEndpoint
                    })
                  }
                >
                  <SelectTrigger className="h-[42px] border-[var(--line-strong)] bg-[var(--bg)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gp">CelesTrak GP group</SelectItem>
                    <SelectItem value="supplemental">CelesTrak supplemental</SelectItem>
                    <SelectItem value="url">Custom URL</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              {newSource.endpoint === "gp" ? (
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-[var(--faint)]">Group name</span>
                  <input
                    value={newSource.group}
                    onChange={(event) => setNewSource({ ...newSource, group: event.target.value })}
                    placeholder="stations"
                  />
                </label>
              ) : newSource.endpoint === "supplemental" ? (
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-[var(--faint)]">Supplemental file</span>
                  <input
                    value={newSource.supplementalFile}
                    onChange={(event) =>
                      setNewSource({ ...newSource, supplementalFile: event.target.value })
                    }
                    placeholder="starlink"
                  />
                </label>
              ) : (
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-[var(--faint)]">Source URL</span>
                  <input
                    value={newSource.url}
                    onChange={(event) => setNewSource({ ...newSource, url: event.target.value })}
                    placeholder="https://example.com/catalog.tle"
                  />
                </label>
              )}
            </div>
            <Button className="mt-4" variant="secondary" onClick={addSource}>
              <Plus size={14} className="mr-1 inline" />
              Add source
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
