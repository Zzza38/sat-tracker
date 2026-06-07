import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Clock3, Pause, Play, RotateCcw, SunMoon } from "lucide-react";
import { buildGroundTrack, computeOrbitSnapshot } from "@/shared/propagation/engine";
import { predictPassesForSatellite } from "@/shared/passes/predictor-core";
import { formatDuration, formatTimestamp } from "@/shared/utils/date";
import { useApp } from "../context/AppContext";
import { useTicker } from "../hooks/useTicker";
import { Globe3D } from "../components/Globe3D";
import { Map2D, type TrackedSatelliteView } from "../components/Map2D";
import { RadarScope } from "../components/RadarScope";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Slider } from "../components/ui/slider";

const TRACK_WINDOW_MINUTES = 180;
const TRACK_STEP_SECONDS = 60;
const INITIAL_TIMELINE_MIN_MINUTES = -180;
const INITIAL_TIMELINE_MAX_MINUTES = 180;
const TIMELINE_STEP_MINUTES = 0.5;
const TRACKER_STATE_KEY = "sat-tracker-timeline";

type TimelineDragState = {
  pointerId: number;
  startX: number;
  startOffset: number;
  minutesPerPixel: number;
};

function formatTimelineOffset(minutes: number) {
  const rounded = Math.round(minutes);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  const magnitude = Math.abs(rounded);

  if (magnitude < 60) {
    return `${sign}${magnitude}m`;
  }

  if (magnitude < 1440) {
    const hours = magnitude / 60;
    return `${sign}${Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)}h`;
  }

  const days = magnitude / 1440;
  return `${sign}${Number.isInteger(days) ? days.toFixed(0) : days.toFixed(1)}d`;
}

function clampTimelineOffset(minutes: number, min: number, max: number) {
  return Math.min(max, Math.max(min, minutes));
}

function roundTimelineOffset(minutes: number) {
  return Math.round(minutes / TIMELINE_STEP_MINUTES) * TIMELINE_STEP_MINUTES;
}

function rangeForTimelineOffset(minutes: number) {
  if (
    minutes >= INITIAL_TIMELINE_MIN_MINUTES &&
    minutes <= INITIAL_TIMELINE_MAX_MINUTES
  ) {
    return {
      min: INITIAL_TIMELINE_MIN_MINUTES,
      max: INITIAL_TIMELINE_MAX_MINUTES
    };
  }

  return {
    min: Math.min(INITIAL_TIMELINE_MIN_MINUTES, minutes),
    max: Math.max(INITIAL_TIMELINE_MAX_MINUTES, minutes)
  };
}

function readTrackerState() {
  try {
    return JSON.parse(sessionStorage.getItem(TRACKER_STATE_KEY) ?? "{}") as {
      currentTime?: string;
      live?: boolean;
      playing?: boolean;
      playbackSpeed?: number;
      showSunMoon?: boolean;
    };
  } catch {
    return {};
  }
}

export function TrackerPage() {
  const storedTrackerState = useMemo(readTrackerState, []);
  const initialAnchor = Date.now();
  const storedOffset =
    storedTrackerState.live === false && storedTrackerState.currentTime
      ? (new Date(storedTrackerState.currentTime).getTime() - initialAnchor) / 60000
      : 0;
  const initialOffset = Number.isFinite(storedOffset) ? storedOffset : 0;
  const {
    satellites,
    watchlistIds,
    selectedSatellite,
    selectedSatelliteId,
    observer,
    trackerViewMode,
    setTrackerViewMode,
    trackerPreviewRequest,
    selectSatellite,
    toggleWatchlist,
    refreshSelectedSatellite,
    getSatelliteColor,
    setSatelliteColor
  } = useApp();
  const visibleSatellites = useMemo(() => {
    if (watchlistIds.length > 0) {
      const recordsById = new Map(satellites.map((satellite) => [satellite.id, satellite]));
      const watched = watchlistIds.flatMap((id) => {
        const satellite = recordsById.get(id);
        return satellite ? [satellite] : [];
      });
      return selectedSatellite && !watchlistIds.includes(selectedSatellite.id)
        ? [selectedSatellite, ...watched]
        : watched;
    }

    return selectedSatellite ? [selectedSatellite] : [];
  }, [satellites, selectedSatellite, watchlistIds]);
  const visibleSatelliteIds = useMemo(
    () => visibleSatellites.map((satellite) => satellite.id),
    [visibleSatellites]
  );
  const timelineAnchorRef = useRef(initialAnchor);
  const timelineDragRef = useRef<TimelineDragState | null>(null);
  const dataPanelRef = useRef<HTMLElement | null>(null);
  const [timelineOffsetMin, setTimelineOffsetMin] = useState(initialOffset);
  const [timelineRange, setTimelineRange] = useState(rangeForTimelineOffset(initialOffset));
  const [timelineLive, setTimelineLive] = useState(storedTrackerState.live ?? true);
  const [timelinePlaying, setTimelinePlaying] = useState(storedTrackerState.playing ?? false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(storedTrackerState.playbackSpeed ?? 1);
  const [showSunMoon, setShowSunMoon] = useState(storedTrackerState.showSunMoon ?? true);
  const liveNow = useTicker(100);
  const playbackNow = useTicker(50);
  const previousPlaybackTickRef = useRef(playbackNow.getTime());
  const currentTime = useMemo(
    () =>
      timelineLive
        ? liveNow
        : new Date(timelineAnchorRef.current + timelineOffsetMin * 60000),
    [liveNow, timelineLive, timelineOffsetMin]
  );
  const persistedStateRef = useRef({
    currentTime: currentTime.toISOString(),
    live: timelineLive,
    playing: timelinePlaying,
    playbackSpeed,
    showSunMoon
  });
  persistedStateRef.current = {
    currentTime: currentTime.toISOString(),
    live: timelineLive,
    playing: timelinePlaying,
    playbackSpeed,
    showSunMoon
  };

  useEffect(() => {
    return () => {
      try {
        sessionStorage.setItem(TRACKER_STATE_KEY, JSON.stringify(persistedStateRef.current));
      } catch {
        // Ignore storage failures in restricted environments.
      }
    };
  }, []);
  const trackTimeKey = Math.floor(currentTime.getTime() / 30000);
  const trackStart = useMemo(
    () => new Date(trackTimeKey * 30000 - (TRACK_WINDOW_MINUTES / 2) * 60000),
    [trackTimeKey]
  );
  const groundTracksById = useMemo(() => {
    return new Map(
      visibleSatellites.map((satellite) => [
        satellite.id,
        buildGroundTrack(
          satellite,
          trackStart,
          TRACK_WINDOW_MINUTES + 1,
          TRACK_STEP_SECONDS
        )
      ])
    );
  }, [trackStart, visibleSatellites]);

  useEffect(() => {
    const previous = previousPlaybackTickRef.current;
    const next = playbackNow.getTime();
    previousPlaybackTickRef.current = next;

    if (!timelinePlaying || timelineLive) {
      return;
    }

    const elapsedMinutes = ((next - previous) / 60000) * playbackSpeed;
    setTimelineOffsetMin((current) =>
      clampTimelineOffset(current + elapsedMinutes, timelineRange.min, timelineRange.max)
    );
  }, [playbackNow, playbackSpeed, timelineLive, timelinePlaying, timelineRange]);

  useEffect(() => {
    if (!trackerPreviewRequest) {
      return;
    }

    const previewAnchor = Date.now();
    timelineAnchorRef.current = previewAnchor;
    previousPlaybackTickRef.current = previewAnchor;
    const previewOffset = (new Date(trackerPreviewRequest.startTime).getTime() - previewAnchor) / 60000;
    setTimelineRange((current) => ({
      min: Math.min(current.min, rangeForTimelineOffset(previewOffset).min),
      max: Math.max(current.max, rangeForTimelineOffset(previewOffset).max)
    }));
    setTimelineOffsetMin(previewOffset);
    setTimelineLive(false);
    setTimelinePlaying(true);
    setPlaybackSpeed(1);
  }, [trackerPreviewRequest]);

  const trackedSatellites = useMemo<TrackedSatelliteView[]>(
    () =>
      visibleSatellites.map((satellite) => {
        const snapshot = computeOrbitSnapshot(satellite, currentTime, observer);
        return {
          id: satellite.id,
          name: satellite.name,
          noradId: satellite.noradId,
          latitudeDeg: snapshot.latitudeDeg,
          longitudeDeg: snapshot.longitudeDeg,
          altitudeKm: snapshot.altitudeKm,
          azimuthDeg: snapshot.azimuthDeg,
          elevationDeg: snapshot.elevationDeg,
          rangeKm: snapshot.rangeKm,
          groundTrack: groundTracksById.get(satellite.id) ?? [],
          selected: satellite.id === selectedSatelliteId,
          color: getSatelliteColor(satellite.id, visibleSatelliteIds)
        };
      }),
    [currentTime, getSatelliteColor, groundTracksById, observer, selectedSatelliteId, visibleSatelliteIds, visibleSatellites]
  );

  const focusSatellite = selectedSatellite ?? visibleSatellites[0];
  const selectedTrackedSatellite = trackedSatellites.find((satellite) => satellite.id === focusSatellite?.id);
  const selectedSnapshot = useMemo(() => {
    if (!focusSatellite) {
      return null;
    }

    return computeOrbitSnapshot(focusSatellite, currentTime, observer);
  }, [currentTime, focusSatellite, observer]);
  const passWindowKey = Math.floor(currentTime.getTime() / 60000);
  const upcomingPasses = useMemo(() => {
    if (!focusSatellite) {
      return [];
    }

    const passStart = new Date(passWindowKey * 60000);
    return predictPassesForSatellite(focusSatellite, observer, {
      start: passStart,
      end: new Date(passStart.getTime() + 3 * 86400000),
      minElevationDeg: observer.minElevationDeg,
      stepSeconds: 45
    }).slice(0, 4);
  }, [focusSatellite, observer, passWindowKey]);

  function goLive() {
    timelineAnchorRef.current = Date.now();
    timelineDragRef.current = null;
    setTimelineOffsetMin(0);
    setTimelineRange({
      min: INITIAL_TIMELINE_MIN_MINUTES,
      max: INITIAL_TIMELINE_MAX_MINUTES
    });
    setTimelineLive(true);
    setTimelinePlaying(false);
  }

  function togglePlayback() {
    if (timelineLive) {
      timelineAnchorRef.current = Date.now();
      setTimelineOffsetMin(0);
      setTimelineLive(false);
      setTimelinePlaying(false);
      return;
    }

    setTimelinePlaying((current) => !current);
  }

  function changePlaybackSpeed(value: number) {
    setPlaybackSpeed(value);
    if (timelineLive) {
      timelineAnchorRef.current = Date.now();
      setTimelineOffsetMin(0);
      setTimelineLive(false);
      setTimelinePlaying(true);
    }
  }

  function setTimelineOffset(value: number) {
    const nextValue = roundTimelineOffset(value);
    setTimelineLive(false);
    setTimelinePlaying(false);
    setTimelineOffsetMin(nextValue);
    setTimelineRange(rangeForTimelineOffset(nextValue));
  }

  function handleTimelinePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const span = timelineRange.max - timelineRange.min;
    const clickedValue =
      timelineRange.min + ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * span;
    const nextValue = roundTimelineOffset(clickedValue);

    event.currentTarget.setPointerCapture(event.pointerId);
    timelineDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startOffset: nextValue,
      minutesPerPixel: span / Math.max(bounds.width, 1)
    };
    setTimelineOffset(nextValue);
  }

  function handleTimelinePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = timelineDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    setTimelineOffset(drag.startOffset + (event.clientX - drag.startX) * drag.minutesPerPixel);
  }

  function handleTimelinePointerEnd(event: PointerEvent<HTMLDivElement>) {
    const drag = timelineDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    timelineDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleTimelineKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const largeStep = 60;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setTimelineOffset(visibleTimelineOffsetMin - TIMELINE_STEP_MINUTES);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setTimelineOffset(visibleTimelineOffsetMin + TIMELINE_STEP_MINUTES);
    } else if (event.key === "PageDown") {
      event.preventDefault();
      setTimelineOffset(visibleTimelineOffsetMin - largeStep);
    } else if (event.key === "PageUp") {
      event.preventDefault();
      setTimelineOffset(visibleTimelineOffsetMin + largeStep);
    } else if (event.key === "Home") {
      event.preventDefault();
      setTimelineOffset(0);
    }
  }

  function inspectSatellite(id: string) {
    selectSatellite(id);
    requestAnimationFrame(() => {
      dataPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  if (!focusSatellite || !selectedSnapshot || trackedSatellites.length === 0) {
    return (
      <div className="panel p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Live tracker</h1>
        <p className="mt-2 text-[var(--muted)]">Add a satellite in Catalog to start live tracking.</p>
      </div>
    );
  }

  async function untrackSatellite(id: string) {
    let nextWatchlistIds = watchlistIds;
    if (watchlistIds.includes(id)) {
      nextWatchlistIds = await toggleWatchlist(id);
    }

    if (id === selectedSatelliteId) {
      selectSatellite(nextWatchlistIds[0] ?? null);
    }
  }

  const visibleTimelineOffsetMin = timelineLive ? 0 : timelineOffsetMin;
  const timelineSpan = timelineRange.max - timelineRange.min;
  const timelineThumbPercent =
    ((visibleTimelineOffsetMin - timelineRange.min) / Math.max(timelineSpan, 1)) * 100;
  const timelineCenterPercent =
    ((0 - timelineRange.min) / Math.max(timelineSpan, 1)) * 100;
  const timelineFillStartPercent = Math.min(timelineCenterPercent, timelineThumbPercent);
  const timelineFillWidthPercent = Math.abs(timelineThumbPercent - timelineCenterPercent);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Live tracker</p>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Orbital view</h1>
          <p className="mono mt-1.5 text-sm text-[var(--muted)]">
            Showing {trackedSatellites.length} satellite
            {trackedSatellites.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant={trackerViewMode === "2d" ? "default" : "secondary"} onClick={() => setTrackerViewMode("2d")}>
            2D Map
          </Button>
          <Button variant={trackerViewMode === "3d" ? "default" : "secondary"} onClick={() => setTrackerViewMode("3d")}>
            3D Globe
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {trackedSatellites.map((satellite) => (
          <div
            key={satellite.id}
            className="flex cursor-pointer items-center gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
            role="button"
            tabIndex={0}
            title="Inspect this satellite"
            onClick={() => inspectSatellite(satellite.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                inspectSatellite(satellite.id);
              }
            }}
          >
            <input
              className="satellite-color-picker"
              type="color"
              value={satellite.color}
              title="Change satellite color"
              aria-label={`Change ${satellite.name} color`}
              onChange={(event) => void setSatelliteColor(satellite.id, event.target.value)}
            />
            <span className="font-medium">{satellite.name}</span>
            <span className="mono text-xs text-[var(--faint)]">{satellite.noradId}</span>
            {watchlistIds.includes(satellite.id) ? (
              <Button variant="ghost" size="xs" onClick={() => void untrackSatellite(satellite.id)}>
                Untrack
              </Button>
            ) : (
              <span className="text-xs text-[var(--faint)]">selected</span>
            )}
          </div>
        ))}
      </div>

      <Card className="tracker-timeline border-[var(--line-strong)] bg-[var(--surface)] py-0 shadow-none">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
                <Clock3 size={15} className="text-[var(--muted)]" />
                <span>Timeline</span>
                {timelineLive ? (
                  <span className="rounded-full border border-[rgba(101,189,142,0.25)] bg-[rgba(101,189,142,0.12)] px-2 py-0.5 text-[11px] font-semibold text-[var(--success)]">
                    Live
                  </span>
                ) : timelinePlaying ? (
                  <span className="rounded-full border border-[rgba(108,140,255,0.25)] bg-[rgba(108,140,255,0.12)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
                    {playbackSpeed}x
                  </span>
                ) : null}
              </div>
              <div className="mono mt-1 text-xs text-[var(--muted)]">{currentTime.toLocaleString()}</div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant={showSunMoon ? "default" : "secondary"}
                size="sm"
                className="h-8"
                onClick={() => setShowSunMoon((current) => !current)}
              >
                <SunMoon size={14} />
                Sun/Moon
              </Button>
              <div className="grid w-[220px] grid-cols-[42px_1fr_48px] items-center gap-2 rounded-md border border-[var(--line-strong)] bg-[var(--surface-2)] px-3 py-2">
                <span className="text-xs font-medium text-[var(--muted)]">Speed</span>
                <Slider
                  min={0.25}
                  max={120}
                  step={0.25}
                  value={[playbackSpeed]}
                  aria-label="Playback speed"
                  onValueChange={([value]) => changePlaybackSpeed(value ?? 1)}
                />
                <span className="mono text-right text-xs text-[var(--text)]">{playbackSpeed.toFixed(playbackSpeed < 10 ? 2 : 0)}x</span>
              </div>
              <Button variant="secondary" size="sm" className="h-8" onClick={togglePlayback}>
                {timelineLive || timelinePlaying ? <Pause size={14} /> : <Play size={14} />}
                {timelineLive || timelinePlaying ? "Pause" : "Play"}
              </Button>
              <Button
                variant={timelineLive ? "default" : "secondary"}
                size="sm"
                className="h-8"
                onClick={goLive}
              >
                <RotateCcw size={14} />
                Live
              </Button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-[56px_1fr_56px] items-center gap-3">
            <span className="mono text-xs text-[var(--faint)]">{formatTimelineOffset(timelineRange.min)}</span>
            <div
              className="timeline-infinite-scrubber"
              role="slider"
              tabIndex={0}
              aria-label="Timeline offset"
              aria-valuemin={timelineRange.min}
              aria-valuemax={timelineRange.max}
              aria-valuenow={visibleTimelineOffsetMin}
              aria-valuetext={formatTimelineOffset(visibleTimelineOffsetMin)}
              onPointerDown={handleTimelinePointerDown}
              onPointerMove={handleTimelinePointerMove}
              onPointerUp={handleTimelinePointerEnd}
              onPointerCancel={handleTimelinePointerEnd}
              onKeyDown={handleTimelineKeyDown}
            >
              <div className="timeline-infinite-track">
                <div
                  className="timeline-infinite-fill"
                  style={{
                    left: `${timelineFillStartPercent}%`,
                    width: `${timelineFillWidthPercent}%`
                  }}
                />
                <div
                  className="timeline-infinite-thumb"
                  style={{ left: `${timelineThumbPercent}%` }}
                />
              </div>
              <div
                className="pointer-events-none absolute top-1/2 z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--bg)] bg-[var(--success)] shadow-[0_0_0_2px_rgba(101,189,142,0.22)]"
                style={{ left: `${timelineCenterPercent}%` }}
                aria-hidden="true"
              />
            </div>
            <span className="mono text-right text-xs text-[var(--faint)]">{formatTimelineOffset(timelineRange.max)}</span>
          </div>
        </CardContent>
      </Card>

      {trackerViewMode === "2d" ? (
        <Map2D
          observer={{ latitude: observer.latitude, longitude: observer.longitude }}
          satellites={trackedSatellites}
          currentTime={currentTime}
          showSunMoon={showSunMoon}
          onSatelliteDoubleClick={inspectSatellite}
        />
      ) : (
        <Globe3D
          observer={observer}
          satellites={trackedSatellites}
          currentTime={currentTime}
          showSunMoon={showSunMoon}
          onSatelliteDoubleClick={inspectSatellite}
        />
      )}

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section ref={dataPanelRef} className="panel scroll-mt-16 p-5 md:scroll-mt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="label">Selected satellite</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-[var(--text)]">{focusSatellite.name}</h2>
              <p className="mono mt-1.5 text-sm text-[var(--muted)]">
                NORAD ID {focusSatellite.noradId}
                {focusSatellite.internationalDesignator ? ` · ${focusSatellite.internationalDesignator}` : ""}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void refreshSelectedSatellite()}>
              Refresh TLE
            </Button>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-[var(--text)]">Upcoming passes</h3>
              <span className="mono text-xs text-[var(--muted)]">Next 3 days</span>
            </div>
            <div className="mt-3 overflow-auto">
              <table>
                <thead>
                  <tr>
                    <th>AOS</th>
                    <th>Max El</th>
                    <th>Duration</th>
                    <th>Azimuth</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingPasses.map((pass) => (
                    <tr key={`${pass.satelliteId}-${pass.aos}`}>
                      <td className="mono">{formatTimestamp(pass.aos)}</td>
                      <td>{pass.maxElevationDeg.toFixed(1)}°</td>
                      <td>{formatDuration(pass.durationSec)}</td>
                      <td className="mono">
                        {pass.aosAzimuthDeg.toFixed(0)}°{" -> "}{pass.losAzimuthDeg.toFixed(0)}°
                      </td>
                    </tr>
                  ))}
                  {upcomingPasses.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-5 text-center text-sm text-[var(--muted)]">
                        No passes above the current horizon mask.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <RadarScope
          satellites={trackedSatellites}
          selectedSatelliteId={focusSatellite.id}
          minElevationDeg={observer.minElevationDeg}
          onSatelliteDoubleClick={inspectSatellite}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          ["Latitude", `${selectedSnapshot.latitudeDeg.toFixed(4)}°`],
          ["Longitude", `${selectedSnapshot.longitudeDeg.toFixed(4)}°`],
          ["Altitude", `${selectedSnapshot.altitudeKm.toFixed(1)} km`],
          ["Velocity", `${selectedSnapshot.velocityKmS.toFixed(2)} km/s`],
          ["Azimuth", `${selectedSnapshot.azimuthDeg.toFixed(1)}°`],
          ["Elevation", `${selectedSnapshot.elevationDeg.toFixed(1)}°`],
          ["Range", `${selectedSnapshot.rangeKm.toFixed(1)} km`],
          ["Footprint", selectedTrackedSatellite ? `${(Math.acos(6371 / (6371 + selectedTrackedSatellite.altitudeKm)) * 6371).toFixed(0)} km` : "n/a"],
          ["Sunlit", selectedSnapshot.sunlit ? "Yes" : "No"]
        ].map(([label, value]) => (
          <div key={label} className="panel-strong p-4">
            <div className="text-xs font-medium text-[var(--faint)]">{label}</div>
            <div className="mono mt-1.5 text-xl text-[var(--text)]">{value}</div>
          </div>
        ))}
      </div>

    </div>
  );
}
