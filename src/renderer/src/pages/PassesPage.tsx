import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { predictPassesBulk, passesToCsv, passesToIcs } from "@/shared/passes/predictor";
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
    return sessionStorage.getItem(PASS_COLOR_BY_ELEVATION_KEY) === "true";
  } catch {
    return false;
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
    selectedSatellite
  } = useApp();
  const geometryRef = useRef<HTMLElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(7);
  const [error, setError] = useState<string | null>(null);
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

  const computePasses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const targets = visiblePassTargets;

      if (targets.length === 0) {
        setPasses([]);
        setError("No satellites selected for pass prediction.");
        return;
      }

      const end = new Date(Date.now() + days * 86400000);
      const results = await predictPassesBulk(targets, observer, {
        start: new Date(),
        end,
        minElevationDeg: observer.minElevationDeg,
        stepSeconds: 45
      });
      setPasses(results);
      selectPass(results[0] ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pass prediction failed.");
    } finally {
      setLoading(false);
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

  return (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <section className="panel p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label">Pass predictor</p>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Ground station passes</h1>
            <p className="mt-1.5 text-sm text-[var(--muted)]">
              Observer {observer.name} · min elevation {observer.minElevationDeg}°
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid w-[260px] grid-cols-[1fr_58px] items-center gap-3 rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-3 py-2">
              <Slider
                min={1}
                max={14}
                step={1}
                value={[days]}
                aria-label="Pass prediction window"
                onValueChange={([value]) => setDays(value ?? 7)}
              />
              <span className="mono text-right text-xs text-[var(--text)]">{days}d</span>
            </div>
            <Button onClick={() => void computePasses()}>{loading ? "Computing..." : "Compute Passes"}</Button>
            <Button
              variant="secondary"
              onClick={() => void saveTextFile(passesToCsv(passes), "passes.csv")}
              disabled={passes.length === 0}
            >
              Export CSV
            </Button>
            <Button
              variant="secondary"
              onClick={() => void saveTextFile(passesToIcs(passes, observer.name), "passes.ics")}
              disabled={passes.length === 0}
            >
              Export ICS
            </Button>
          </div>
        </div>

        {error ? <p className="mono mt-4 text-sm text-[var(--danger)]">{error}</p> : null}

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

        <div className="mt-5 overflow-auto">
          <table>
            <thead>
              <tr>
                <th>Satellite</th>
                <th>AOS</th>
                <th>LOS</th>
                <th>Max El</th>
                <th>Duration</th>
                <th>Lit</th>
              </tr>
            </thead>
            <tbody>
              {passes.map((pass) => (
                <tr
                  key={`${pass.satelliteId}-${pass.aos}`}
                  className={clsx("cursor-pointer", selectedPass?.aos === pass.aos && "bg-[var(--accent-soft)]")}
                  onClick={() => selectPass(pass)}
                  onDoubleClick={() => inspectPass(pass)}
                  title="Double-click to inspect pass geometry"
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
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section ref={geometryRef} className="panel scroll-mt-4 p-5">
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
