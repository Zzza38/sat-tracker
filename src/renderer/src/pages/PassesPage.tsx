import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { predictPassesBulkStreaming, passesToCsv, passesToIcs } from "@/shared/passes/predictor";
import { formatDuration, formatTimestamp } from "@/shared/utils/date";
import { useApp } from "../context/AppContext";
import { ElevationChart } from "../components/ElevationChart";
import { ElevationColorLegend } from "../components/ElevationColorLegend";
import { SkyPlot } from "../components/SkyPlot";
import { Button } from "../components/ui/button";
import { Slider } from "../components/ui/slider";
import { Switch } from "../components/ui/switch";
import { saveTextFile } from "../lib/platform";
import { elevationToColor } from "@/shared/passes/elevation-color";

const PASS_COLOR_BY_ELEVATION_KEY = "sat-tracker-passes-color-by-elevation";

function readColorByElevationPreference() {
  try {
    const stored = sessionStorage.getItem(PASS_COLOR_BY_ELEVATION_KEY);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

export function PassesPage() {
  const {
    observer,
    passes,
    setPasses,
    selectPass,
    selectedPass,
    getSatelliteColor,
    satellites,
    watchlistIds,
    selectedSatellite,
    previewPassOnTracker
  } = useApp();
  const geometryRef = useRef<HTMLElement | null>(null);
  const selectedPassRef = useRef(selectedPass);
  const computeRequestRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(7);
  const [daysDraft, setDaysDraft] = useState(7);
  const [error, setError] = useState<string | null>(null);
  const [computeProgress, setComputeProgress] = useState<{ completed: number; total: number } | null>(null);
  const [colorByElevation, setColorByElevation] = useState(readColorByElevationPreference);
  const visiblePassTargets = useMemo(() => {
    if (watchlistIds.length > 0) {
      const recordsById = new Map(satellites.map((satellite) => [satellite.id, satellite]));
      return watchlistIds.flatMap((id) => {
        const satellite = recordsById.get(id);
        return satellite ? [satellite] : [];
      });
    }

    return selectedSatellite ? [selectedSatellite] : [];
  }, [satellites, selectedSatellite, watchlistIds]);
  const visibleSatelliteIds = useMemo(
    () => visiblePassTargets.map((satellite) => satellite.id),
    [visiblePassTargets]
  );

  useEffect(() => {
    selectedPassRef.current = selectedPass;
  }, [selectedPass]);

  const computePasses = useCallback(async () => {
    const requestId = computeRequestRef.current + 1;
    computeRequestRef.current = requestId;
    const streamedPasses: typeof passes = [];
    setLoading(true);
    setError(null);
    setComputeProgress(null);
    setPasses([]);
    try {
      const targets = visiblePassTargets;

      if (targets.length === 0) {
        setPasses([]);
        setError("No satellites selected for pass prediction.");
        setComputeProgress(null);
        return;
      }

      setComputeProgress({ completed: 0, total: targets.length });
      const start = new Date(Math.floor(Date.now() / 60000) * 60000);
      const end = new Date(start.getTime() + days * 86400000);
      const results = await predictPassesBulkStreaming(
        targets,
        observer,
        {
          start,
          end,
          minElevationDeg: observer.minElevationDeg,
          stepSeconds: 45
        },
        ({ passes: satellitePasses, completed, total }) => {
          if (computeRequestRef.current !== requestId) {
            return;
          }

          streamedPasses.push(...satellitePasses);
          streamedPasses.sort((left, right) => left.aos.localeCompare(right.aos));
          setPasses([...streamedPasses]);
          setComputeProgress({ completed, total });
        }
      );
      if (computeRequestRef.current !== requestId) {
        return;
      }
      setPasses(results);
      const previous = selectedPassRef.current;
      const preserved = previous
        ? results.find(
            (pass) => pass.satelliteId === previous.satelliteId && pass.aos === previous.aos
          )
        : null;
      selectPass(preserved ?? (previous ? null : results[0] ?? null));
    } catch (caught) {
      if (computeRequestRef.current !== requestId) {
        return;
      }
      setError(caught instanceof Error ? caught.message : "Pass prediction failed.");
    } finally {
      if (computeRequestRef.current === requestId) {
        setLoading(false);
        setComputeProgress(null);
      }
    }
  }, [days, observer, selectPass, setPasses, visiblePassTargets]);

  useEffect(() => {
    void computePasses();
  }, [computePasses]);

  const selectedPassSatelliteColor = selectedPass
    ? getSatelliteColor(selectedPass.satelliteId, visibleSatelliteIds)
    : undefined;
  const elevationColorOptions = useMemo(
    () => ({ minElevationDeg: observer.minElevationDeg, maxElevationDeg: 90 }),
    [observer.minElevationDeg]
  );

  function toggleColorByElevation(checked: boolean) {
    setColorByElevation(checked);
    try {
      sessionStorage.setItem(PASS_COLOR_BY_ELEVATION_KEY, String(checked));
    } catch {
      // Ignore storage failures in restricted environments.
    }
  }

  function inspectPass(pass: typeof selectedPass) {
    if (!pass) {
      return;
    }

    selectPass(pass);
    requestAnimationFrame(() => {
      geometryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function exportFile(content: string, name: string) {
    try {
      await saveTextFile(content, name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Failed to save ${name}.`);
    }
  }

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <section className="panel min-w-0 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="label">Pass predictor</p>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Ground station passes</h1>
            <p className="mt-1.5 text-sm text-[var(--muted)]">
              Observer {observer.name} · min elevation {observer.minElevationDeg}°
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-3 xl:w-auto">
            <div className="grid w-full grid-cols-[1fr_58px] items-center gap-3 rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-3 py-2 sm:w-[260px]">
              <Slider
                min={1}
                max={14}
                step={1}
                value={[daysDraft]}
                aria-label="Pass prediction window"
                onValueChange={([value]) => setDaysDraft(value ?? 7)}
                onValueCommit={([value]) => setDays(value ?? 7)}
              />
              <span className="mono text-right text-xs text-[var(--text)]">{daysDraft}d</span>
            </div>
            <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-3">
              <Button disabled={loading} onClick={() => void computePasses()}>
                {loading ? "Computing..." : (
                  <>
                    <span className="sm:hidden">Compute</span>
                    <span className="hidden sm:inline">Compute Passes</span>
                  </>
                )}
              </Button>
              <Button
                variant="secondary"
                onClick={() => void exportFile(passesToCsv(passes), "passes.csv")}
                disabled={passes.length === 0}
              >
                Export CSV
              </Button>
              <Button
                variant="secondary"
                onClick={() => void exportFile(passesToIcs(passes, observer.name), "passes.ics")}
                disabled={passes.length === 0}
              >
                Export ICS
              </Button>
            </div>
          </div>
        </div>

        {error ? <p className="mono mt-4 text-sm text-[var(--danger)]">{error}</p> : null}
        {loading ? (
          <p className="mono mt-4 text-sm text-[var(--muted)]" role="status">
            Computing passes
            {computeProgress ? ` ${computeProgress.completed}/${computeProgress.total}` : ""}
            {passes.length > 0 ? ` · ${passes.length} found so far` : ""}
            ...
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2.5 text-sm text-[var(--text)]">
            <Switch
              checked={colorByElevation}
              onCheckedChange={toggleColorByElevation}
              aria-label="Color passes by elevation"
            />
            Color by elevation
          </label>
          {colorByElevation ? (
            <div className="min-w-[220px] flex-1">
              <ElevationColorLegend minElevationDeg={observer.minElevationDeg} />
            </div>
          ) : null}
        </div>

        <div className="passes-list mt-5 space-y-2 sm:hidden">
          {passes.map((pass) => {
            const selected =
              selectedPass?.satelliteId === pass.satelliteId && selectedPass.aos === pass.aos;
            return (
              <button
                key={`${pass.satelliteId}-${pass.aos}`}
                type="button"
                className={clsx("pass-card", selected && "selected")}
                onClick={() => inspectPass(pass)}
              >
                <span className="flex min-w-0 items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 font-medium text-[var(--text)]">
                    <span
                      className="size-2.5 shrink-0 rounded-full border border-[rgba(255,255,255,0.35)]"
                      style={{ backgroundColor: getSatelliteColor(pass.satelliteId, visibleSatelliteIds) }}
                      aria-hidden="true"
                    />
                    <span className="truncate">{pass.satelliteName}</span>
                  </span>
                  <span
                    className="mono shrink-0 text-sm font-medium"
                    style={
                      colorByElevation
                        ? { color: elevationToColor(pass.maxElevationDeg, elevationColorOptions) }
                        : undefined
                    }
                  >
                    {pass.maxElevationDeg.toFixed(1)}°
                  </span>
                </span>
                <span className="mono mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
                  <span>AOS {formatTimestamp(pass.aos)}</span>
                  <span>{formatDuration(pass.durationSec)}</span>
                  <span>{pass.illuminated ? "Sunlit" : "In shadow"}</span>
                </span>
              </button>
            );
          })}
          {!loading && passes.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              No passes found for the selected satellites and time window.
            </p>
          ) : null}
        </div>

        <div className="passes-table mt-5 hidden overflow-auto sm:block">
          <table>
            <thead>
              <tr>
                <th>Satellite</th>
                <th>AOS</th>
                <th>Peak</th>
                <th>LOS</th>
                <th>Max El</th>
                <th>Duration</th>
                <th>Lit</th>
              </tr>
            </thead>
            <tbody>
              {passes.map((pass) => {
                const selected =
                  selectedPass?.satelliteId === pass.satelliteId && selectedPass.aos === pass.aos;
                return (
                <tr
                  key={`${pass.satelliteId}-${pass.aos}`}
                  className={clsx("cursor-pointer", selected && "bg-[var(--accent-soft)]")}
                  tabIndex={0}
                  aria-selected={selected}
                  aria-label={`${pass.satelliteName} pass. Enter to inspect geometry.`}
                  onClick={() => selectPass(pass)}
                  onDoubleClick={() => inspectPass(pass)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      inspectPass(pass);
                    }
                  }}
                  title="Click to select, Enter or double-click to inspect geometry"
                >
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="size-2.5 rounded-full border border-[rgba(255,255,255,0.35)]"
                        style={{ backgroundColor: getSatelliteColor(pass.satelliteId, visibleSatelliteIds) }}
                        aria-hidden="true"
                      />
                      {pass.satelliteName}
                    </span>
                  </td>
                  <td className="mono">{formatTimestamp(pass.aos)}</td>
                  <td className="mono">{formatTimestamp(pass.tca)}</td>
                  <td className="mono">{formatTimestamp(pass.los)}</td>
                  <td
                    className={colorByElevation ? "font-medium" : undefined}
                    style={
                      colorByElevation
                        ? { color: elevationToColor(pass.maxElevationDeg, elevationColorOptions) }
                        : undefined
                    }
                  >
                    {pass.maxElevationDeg.toFixed(1)}°
                  </td>
                  <td>{formatDuration(pass.durationSec)}</td>
                  <td>{pass.illuminated ? "Yes" : "No"}</td>
                </tr>
                );
              })}
              {!loading && passes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-[var(--muted)]">
                    No passes found for the selected satellites and time window.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section ref={geometryRef} className="panel min-w-0 scroll-mt-4 p-4 sm:p-5">
        <p className="label">Pass geometry</p>
        {selectedPass ? (
          <div className="mt-4 space-y-5">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-[var(--text)]">{selectedPass.satelliteName}</h2>
              <p className="mono mt-1.5 text-sm text-[var(--muted)]">
                TCA {formatTimestamp(selectedPass.tca)} · {selectedPass.maxElevationDeg.toFixed(1)}° ·{" "}
                {selectedPass.rangeKmAtTca.toFixed(0)} km
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => previewPassOnTracker(selectedPass)}>
              Preview on tracker
            </Button>
            <SkyPlot
              samples={selectedPass.samples}
              minElevationDeg={observer.minElevationDeg}
              colorByElevation={colorByElevation}
              satelliteColor={selectedPassSatelliteColor}
            />
            <ElevationChart
              samples={selectedPass.samples}
              minElevationDeg={observer.minElevationDeg}
              colorByElevation={colorByElevation}
              satelliteColor={selectedPassSatelliteColor}
            />
            {colorByElevation ? (
              <ElevationColorLegend minElevationDeg={observer.minElevationDeg} />
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-[var(--muted)]">Select a pass to inspect look angles.</p>
        )}
      </section>
    </div>
  );
}
