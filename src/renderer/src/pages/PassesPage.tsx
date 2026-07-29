import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { clsx } from "clsx";
import { ArrowDown, ArrowUp, Bell, BellRing } from "lucide-react";
import { predictPassesBulkStreaming, passesToCsv, passesToIcs } from "@/shared/passes/predictor";
import type { PassPrediction } from "@/shared/types";
import { formatDateTimeParts, formatDuration, formatTimestamp, formatTimestampCompact, timeZoneAbbreviation } from "@/shared/utils/date";
import { useApp } from "../context/AppContext";
import { ElevationChart } from "../components/ElevationChart";
import { ElevationColorLegend } from "../components/ElevationColorLegend";
import { SkyPlot } from "../components/SkyPlot";
import { Button } from "../components/ui/button";
import { Slider } from "../components/ui/slider";
import { Switch } from "../components/ui/switch";
import { saveTextFile } from "../lib/platform";
import { elevationToColor } from "@/shared/passes/elevation-color";
import {
  hasPassReminder,
  REMINDERS_CHANGED_EVENT,
  togglePassReminder
} from "../lib/passReminders";
import { requestNotificationPermission } from "../lib/platform";

const PASS_COLOR_BY_ELEVATION_KEY = "sat-tracker-passes-color-by-elevation";

function readColorByElevationPreference() {
  try {
    const stored = localStorage.getItem(PASS_COLOR_BY_ELEVATION_KEY);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

type PassSortKey = "satellite" | "aos" | "tca" | "los" | "maxElevation" | "duration";
type SortDirection = "asc" | "desc";

// Chronological reads naturally; the quality columns are most useful biggest-first,
// so each column opts into the direction an observer actually wants on first click.
const PASS_SORT_DEFAULT_DIRECTION: Record<PassSortKey, SortDirection> = {
  satellite: "asc",
  aos: "asc",
  tca: "asc",
  los: "asc",
  maxElevation: "desc",
  duration: "desc"
};

function comparePasses(left: PassPrediction, right: PassPrediction, key: PassSortKey) {
  switch (key) {
    case "satellite":
      return left.satelliteName.localeCompare(right.satelliteName) || left.aos.localeCompare(right.aos);
    case "tca":
      return left.tca.localeCompare(right.tca);
    case "los":
      return left.los.localeCompare(right.los);
    case "maxElevation":
      return left.maxElevationDeg - right.maxElevationDeg || left.aos.localeCompare(right.aos);
    case "duration":
      return left.durationSec - right.durationSec || left.aos.localeCompare(right.aos);
    default:
      return left.aos.localeCompare(right.aos);
  }
}

interface PassSortHeaderProps {
  columnKey: PassSortKey;
  activeKey: PassSortKey;
  direction: SortDirection;
  onSort: (key: PassSortKey) => void;
  title?: string;
  className?: string;
  children: ReactNode;
}

function PassSortHeader({ columnKey, activeKey, direction, onSort, title, className, children }: PassSortHeaderProps) {
  const active = columnKey === activeKey;
  return (
    <th
      className={className}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      title={title}
    >
      <button type="button" className="pass-sort-header" onClick={() => onSort(columnKey)}>
        {children}
        {active ? (
          direction === "asc" ? (
            <ArrowUp size={11} aria-hidden="true" />
          ) : (
            <ArrowDown size={11} aria-hidden="true" />
          )
        ) : null}
      </button>
    </th>
  );
}

const PASS_DAYS_KEY = "sat-tracker-passes-days";

function readDaysPreference() {
  try {
    const n = Number(localStorage.getItem(PASS_DAYS_KEY) ?? "");
    return Number.isInteger(n) && n >= 1 && n <= 14 ? n : 7;
  } catch {
    return 7;
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
    previewPassOnTracker,
    setPage
  } = useApp();
  const geometryRef = useRef<HTMLElement | null>(null);
  const selectedPassRef = useRef(selectedPass);
  const computeRequestRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(readDaysPreference);
  const [sliderDays, setSliderDays] = useState(days);
  const [error, setError] = useState<string | null>(null);
  const [emptyNotice, setEmptyNotice] = useState(false);
  const [computeProgress, setComputeProgress] = useState<{ completed: number; total: number } | null>(null);
  const [colorByElevation, setColorByElevation] = useState(readColorByElevationPreference);
  const [, setReminderRevision] = useState(0);
  const [sortKey, setSortKey] = useState<PassSortKey>("aos");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
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

  useEffect(() => {
    const refresh = () => setReminderRevision((value) => value + 1);
    window.addEventListener(REMINDERS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(REMINDERS_CHANGED_EVENT, refresh);
  }, []);

  const computePasses = useCallback(async () => {
    const requestId = computeRequestRef.current + 1;
    computeRequestRef.current = requestId;
    const streamedPasses: typeof passes = [];
    setLoading(true);
    setError(null);
    setEmptyNotice(false);
    setComputeProgress(null);
    try {
      const targets = visiblePassTargets;

      if (targets.length === 0) {
        setPasses([]);
        setEmptyNotice(true);
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

  const targetsKey = visibleSatelliteIds.join("|");
  const computeRef = useRef(computePasses);

  useEffect(() => {
    computeRef.current = computePasses;
  });

  useEffect(() => {
    void computeRef.current();
  }, [targetsKey, days, observer.id]);

  const selectedPassSatelliteColor = selectedPass
    ? getSatelliteColor(selectedPass.satelliteId, visibleSatelliteIds)
    : undefined;
  const elevationColorOptions = useMemo(
    () => ({ minElevationDeg: observer.minElevationDeg, maxElevationDeg: 90 }),
    [observer.minElevationDeg]
  );

  const sortedPasses = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...passes].sort((left, right) => comparePasses(left, right, sortKey) * direction);
  }, [passes, sortDirection, sortKey]);

  function applySort(key: PassSortKey) {
    if (key === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection(PASS_SORT_DEFAULT_DIRECTION[key]);
  }

  function toggleColorByElevation(checked: boolean) {
    setColorByElevation(checked);
    try {
      localStorage.setItem(PASS_COLOR_BY_ELEVATION_KEY, String(checked));
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
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      geometryRef.current?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start"
      });
    });
  }

  async function exportFile(content: string, name: string) {
    try {
      await saveTextFile(content, name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Failed to save ${name}.`);
    }
  }

  async function toggleReminder(event: MouseEvent, pass: (typeof passes)[number]) {
    event.stopPropagation();
    if (!hasPassReminder(pass) && !(await requestNotificationPermission())) {
      setError("Notification permission is required to set a pass alert.");
      return;
    }
    togglePassReminder(pass);
    setReminderRevision((value) => value + 1);
  }

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <section className="panel min-w-0 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="label">Pass predictor</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-[var(--text)]">Ground station passes</h1>
            <p className="mt-1.5 text-sm text-[var(--muted)]">
              Observer {observer.name} · min elevation {observer.minElevationDeg}° · times in {timeZoneAbbreviation()}
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-3 xl:w-auto">
            <div className="grid w-full grid-cols-[1fr_58px] items-center gap-3 rounded-md border border-[var(--line-strong)] bg-[var(--bg)] px-3 py-2 sm:w-[260px]">
              <Slider
                min={1}
                max={14}
                step={1}
                value={[sliderDays]}
                aria-label="Pass prediction window"
                onValueChange={([value]) => setSliderDays(value ?? 7)}
                onValueCommit={([value]) => {
                  const next = value ?? 7;
                  setDays(next);
                  try {
                    localStorage.setItem(PASS_DAYS_KEY, String(next));
                  } catch {
                    // Ignore storage failures in restricted environments.
                  }
                }}
              />
              <span className="mono text-right text-xs text-[var(--text)]">{sliderDays}d</span>
            </div>
            <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-3">
              <Button disabled={loading || visiblePassTargets.length === 0} onClick={() => void computePasses()}>
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

        {error ? <p role="alert" className="mono mt-4 text-sm text-[var(--danger)]">{error}</p> : null}
        {!error && emptyNotice ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[var(--muted)]">
            <p>
              Nothing to predict yet. Track satellites in the catalog (or select one on Details)
              and passes for the next {days} {days === 1 ? "day" : "days"} will appear here.
            </p>
            <Button variant="secondary" size="sm" onClick={() => setPage("catalog")}>
              Open catalog
            </Button>
          </div>
        ) : null}
        {loading ? (
          <p className="mono mt-4 text-sm text-[var(--muted)]" role="status">
            Computing passes
            {computeProgress ? ` ${computeProgress.completed}/${computeProgress.total}` : ""}
            {computeProgress && computeProgress.completed > 0 && passes.length > 0
              ? ` · ${passes.length} found so far`
              : ""}
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

        {/* The card list has no column headers to click, so surface sorting explicitly on phones. */}
        <div className="mt-5 flex items-center gap-2 md:hidden">
          <label className="text-xs font-medium text-[var(--faint)]" htmlFor="pass-sort-select">
            Sort by
          </label>
          <select
            id="pass-sort-select"
            className="max-w-[15rem] text-sm"
            value={`${sortKey}:${sortDirection}`}
            onChange={(event) => {
              const [key, direction] = event.target.value.split(":") as [PassSortKey, SortDirection];
              setSortKey(key);
              setSortDirection(direction);
            }}
          >
            <option value="aos:asc">Soonest first</option>
            <option value="aos:desc">Latest first</option>
            <option value="maxElevation:desc">Highest elevation</option>
            <option value="duration:desc">Longest pass</option>
            <option value="satellite:asc">Satellite name</option>
          </select>
        </div>

        <div className={clsx("passes-list mt-3 space-y-2 md:hidden", loading && "opacity-60")}>
          {sortedPasses.map((pass) => {
            const selected =
              selectedPass?.satelliteId === pass.satelliteId && selectedPass.aos === pass.aos;
            return (
              <div
                key={`${pass.satelliteId}-${pass.aos}`}
                className={clsx("pass-card", selected && "selected")}
                role="button"
                tabIndex={0}
                aria-current={selected ? "true" : undefined}
                onClick={() => inspectPass(pass)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    inspectPass(pass);
                  }
                }}
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
                  <span title={`Acquisition of signal (pass start) ${formatTimestamp(pass.aos)}`}>Start (AOS) {formatTimestampCompact(pass.aos)}</span>
                  <span>{formatDuration(pass.durationSec)}</span>
                  <span>{pass.illuminated ? "Sunlit" : "In shadow"}</span>
                </span>
                <button
                  type="button"
                  className={clsx("pass-notify", hasPassReminder(pass) && "active")}
                  onClick={(event) => void toggleReminder(event, pass)}
                >
                  {hasPassReminder(pass) ? <BellRing size={14} /> : <Bell size={14} />}
                  {hasPassReminder(pass) ? "Alert set" : "Notify"}
                </button>
              </div>
            );
          })}
          {!loading && !emptyNotice && passes.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              No passes found for the selected satellites and time window.
            </p>
          ) : null}
        </div>

        <div className={clsx("passes-table mt-5 hidden overflow-auto md:block", loading && "opacity-60")}>
          <table>
            <thead>
              <tr>
                <PassSortHeader columnKey="satellite" activeKey={sortKey} direction={sortDirection} onSort={applySort}>
                  Satellite
                </PassSortHeader>
                <PassSortHeader
                  columnKey="aos"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={applySort}
                  title="Acquisition of signal — when the satellite rises above the horizon mask"
                >
                  Start (AOS)
                </PassSortHeader>
                <PassSortHeader
                  columnKey="tca"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={applySort}
                  title="Time of maximum elevation (TCA)"
                >
                  Peak time
                </PassSortHeader>
                <PassSortHeader
                  columnKey="los"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={applySort}
                  title="Loss of signal — when the satellite sets below the horizon mask"
                >
                  End (LOS)
                </PassSortHeader>
                <PassSortHeader
                  columnKey="maxElevation"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={applySort}
                  className="whitespace-nowrap"
                  title="Highest elevation reached during the pass"
                >
                  Max El
                </PassSortHeader>
                <PassSortHeader
                  columnKey="duration"
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={applySort}
                  className="whitespace-nowrap"
                >
                  Duration
                </PassSortHeader>
                <th className="whitespace-nowrap">Sunlight</th>
                <th>Alert</th>
              </tr>
            </thead>
            <tbody>
              {sortedPasses.map((pass) => {
                const selected =
                  selectedPass?.satelliteId === pass.satelliteId && selectedPass.aos === pass.aos;
                const aosParts = formatDateTimeParts(pass.aos);
                const tcaParts = formatDateTimeParts(pass.tca);
                const losParts = formatDateTimeParts(pass.los);
                return (
                  <tr
                    key={`${pass.satelliteId}-${pass.aos}`}
                    className={clsx("cursor-pointer", selected && "bg-[var(--accent-soft)]")}
                    tabIndex={0}
                    aria-label={`${pass.satelliteName}, AOS ${formatTimestamp(pass.aos)}, max elevation ${pass.maxElevationDeg.toFixed(1)} degrees. Press Enter to inspect pass geometry.`}
                    aria-current={selected ? "true" : undefined}
                    onClick={() => selectPass(pass)}
                    onDoubleClick={() => inspectPass(pass)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        inspectPass(pass);
                      }
                    }}
                    title="Press Enter or double-click to inspect pass geometry"
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
                    <td className="mono">
                      <div className="whitespace-nowrap text-[var(--text)]">{aosParts.datePart}</div>
                      <div className="whitespace-nowrap text-[var(--muted)]">{aosParts.timePart}</div>
                    </td>
                    <td className="mono">
                      <div className="whitespace-nowrap text-[var(--text)]">{tcaParts.datePart}</div>
                      <div className="whitespace-nowrap text-[var(--muted)]">{tcaParts.timePart}</div>
                    </td>
                    <td className="mono">
                      <div className="whitespace-nowrap text-[var(--text)]">{losParts.datePart}</div>
                      <div className="whitespace-nowrap text-[var(--muted)]">{losParts.timePart}</div>
                    </td>
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
                    <td className="whitespace-nowrap">{formatDuration(pass.durationSec)}</td>
                    <td className="whitespace-nowrap">{pass.illuminated ? "Sunlit" : "In shadow"}</td>
                    <td>
                      <Button
                        size="xs"
                        variant={hasPassReminder(pass) ? "default" : "secondary"}
                        onClick={(event) => void toggleReminder(event, pass)}
                      >
                        {hasPassReminder(pass) ? <BellRing size={13} /> : <Bell size={13} />}
                        {hasPassReminder(pass) ? "Set" : "Notify"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!loading && !emptyNotice && passes.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sm text-[var(--muted)]">
                    No passes found for the selected satellites and time window.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section ref={geometryRef} className="panel min-w-0 scroll-mt-16 p-4 sm:p-5">
        <p className="label">Pass geometry</p>
        {selectedPass ? (
          <div className="mt-4 space-y-5">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-[var(--text)]">{selectedPass.satelliteName}</h2>
              <p className="mono mt-1.5 text-sm text-[var(--muted)]">
                <span title="Time of closest approach (maximum elevation)">Closest approach (TCA)</span>{" "}
                {formatTimestamp(selectedPass.tca)} · {selectedPass.maxElevationDeg.toFixed(1)}° ·{" "}
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
