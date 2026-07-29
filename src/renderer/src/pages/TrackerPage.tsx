import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { clsx } from "clsx";
import { Clock3, Pause, Play, RotateCcw, SunMoon } from "lucide-react";
import { buildGroundTrack, computeOrbitSnapshot } from "@/shared/propagation/engine";
import type { GroundTrackPoint, PassPrediction } from "@/shared/types";
import { predictPassesBulkStreaming } from "@/shared/passes/predictor";
import { formatDuration, formatTimestamp, formatTimestampCompact } from "@/shared/utils/date";
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
const MEDIUM_TRACKED_COUNT = 12;
const LARGE_TRACKED_COUNT = 30;
const FAST_PLAYBACK_THRESHOLD = 8;
const COLLAPSED_TRACKED_LIST_COUNT = 12;
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

function trackerLiveIntervalMs(satelliteCount: number) {
  if (satelliteCount > LARGE_TRACKED_COUNT) {
    return 1000;
  }

  if (satelliteCount > MEDIUM_TRACKED_COUNT) {
    return 500;
  }

  return 250;
}

function groundTrackStepSeconds(satelliteCount: number) {
  if (satelliteCount > LARGE_TRACKED_COUNT) {
    return 180;
  }

  if (satelliteCount > MEDIUM_TRACKED_COUNT) {
    return 120;
  }

  return TRACK_STEP_SECONDS;
}

function readTrackerState() {
  try {
    return JSON.parse(localStorage.getItem(TRACKER_STATE_KEY) ?? "{}") as {
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
    selectedPass,
    observer,
    trackerViewMode,
    setTrackerViewMode,
    trackerPreviewRequest,
    clearTrackerPreviewRequest,
    setPage,
    selectSatellite,
    toggleWatchlist,
    refreshSelectedSatellite,
    refreshingSelected,
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
  const [trackedListExpanded, setTrackedListExpanded] = useState(false);
  const [globeMounted, setGlobeMounted] = useState(trackerViewMode === "3d");
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);
  const [refreshIsError, setRefreshIsError] = useState(false);
  const liveNow = useTicker(trackerLiveIntervalMs(visibleSatellites.length), timelineLive);
  const playbackNow = useTicker(
    visibleSatellites.length > LARGE_TRACKED_COUNT ? 250 : 100,
    timelinePlaying && !timelineLive
  );
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
        localStorage.setItem(TRACKER_STATE_KEY, JSON.stringify(persistedStateRef.current));
      } catch {
        // Ignore storage failures in restricted environments.
      }
    };
  }, []);
  const trackRefreshMs = visibleSatellites.length > LARGE_TRACKED_COUNT ? 60000 : 30000;
  const trackTimeKey = Math.floor(currentTime.getTime() / trackRefreshMs);
  const trackStepSeconds = groundTrackStepSeconds(visibleSatellites.length);
  const trackStart = useMemo(
    () => new Date(trackTimeKey * trackRefreshMs - (TRACK_WINDOW_MINUTES / 2) * 60000),
    [trackRefreshMs, trackTimeKey]
  );
  const tracksPaused = timelinePlaying && playbackSpeed >= FAST_PLAYBACK_THRESHOLD;
  const [groundTracksById, setGroundTracksById] = useState<Map<string, GroundTrackPoint[]>>(
    () => new Map()
  );
  useEffect(() => {
    // Freeze track refresh during fast playback; tracks resume when speed drops or playback stops.
    if (tracksPaused) {
      return;
    }

    let cancelled = false;
    let index = 0;
    // Spread the rebuild over ~4 frames so no single frame blocks >~30ms.
    const chunkSize = Math.max(1, Math.ceil(visibleSatellites.length / 4));
    const buildChunk = () => {
      if (cancelled) {
        return;
      }

      const additions = new Map<string, GroundTrackPoint[]>();
      for (const satellite of visibleSatellites.slice(index, index + chunkSize)) {
        try {
          additions.set(
            satellite.id,
            buildGroundTrack(satellite, trackStart, TRACK_WINDOW_MINUTES + 1, trackStepSeconds)
          );
        } catch {
          additions.set(satellite.id, []);
        }
      }

      setGroundTracksById((previous) => new Map([...previous, ...additions]));
      index += chunkSize;
      if (index < visibleSatellites.length) {
        requestAnimationFrame(buildChunk);
      }
    };
    buildChunk();

    return () => {
      cancelled = true;
    };
  }, [trackStart, trackStepSeconds, visibleSatellites, tracksPaused]);

  useEffect(() => {
    const previous = previousPlaybackTickRef.current;
    const next = playbackNow.getTime();
    previousPlaybackTickRef.current = next;

    if (!timelinePlaying || timelineLive) {
      return;
    }

    const elapsedMinutes = ((next - previous) / 60000) * playbackSpeed;
    if (selectedPass) {
      const losOffsetMin =
        (new Date(selectedPass.los).getTime() - timelineAnchorRef.current) / 60000;
      if (timelineOffsetMin + elapsedMinutes >= losOffsetMin) {
        setTimelineOffsetMin(clampTimelineOffset(losOffsetMin, timelineRange.min, timelineRange.max));
        setTimelinePlaying(false);
        return;
      }
    }
    setTimelineOffsetMin((current) =>
      clampTimelineOffset(current + elapsedMinutes, timelineRange.min, timelineRange.max)
    );
  }, [playbackNow, playbackSpeed, selectedPass, timelineLive, timelineOffsetMin, timelinePlaying, timelineRange]);

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
      visibleSatellites.flatMap((satellite) => {
        // A decayed or malformed satellite must not take down the whole tracker.
        try {
          const snapshot = computeOrbitSnapshot(satellite, currentTime, observer);
          return [{
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
          }];
        } catch {
          return [];
        }
      }),
    [currentTime, getSatelliteColor, groundTracksById, observer, selectedSatelliteId, visibleSatelliteIds, visibleSatellites]
  );
  const displayedTrackedSatellites = trackedListExpanded
    ? trackedSatellites
    : trackedSatellites.slice(0, COLLAPSED_TRACKED_LIST_COUNT);
  const hiddenTrackedSatelliteCount = Math.max(
    trackedSatellites.length - displayedTrackedSatellites.length,
    0
  );

  useEffect(() => {
    if (trackedSatellites.length <= COLLAPSED_TRACKED_LIST_COUNT && trackedListExpanded) {
      setTrackedListExpanded(false);
    }
  }, [trackedListExpanded, trackedSatellites.length]);

  const focusSatellite = selectedSatellite ?? visibleSatellites[0];
  const selectedTrackedSatellite = trackedSatellites.find((satellite) => satellite.id === focusSatellite?.id);
  const selectedSnapshot = useMemo(() => {
    if (!focusSatellite) {
      return null;
    }

    try {
      return computeOrbitSnapshot(focusSatellite, currentTime, observer);
    } catch {
      return null;
    }
  }, [currentTime, focusSatellite, observer]);
  // Coarsen the re-anchoring window during fast playback so prediction does not
  // refire every simulated minute.
  const passWindowMs =
    timelinePlaying && playbackSpeed >= FAST_PLAYBACK_THRESHOLD ? 5 * 60000 : 60000;
  const passWindowKey = Math.floor(currentTime.getTime() / passWindowMs);
  const [upcomingPasses, setUpcomingPasses] = useState<PassPrediction[]>([]);
  // Prediction takes a moment; without this the panel claims "no passes" before it has looked.
  const [upcomingPassesLoading, setUpcomingPassesLoading] = useState(false);
  const passRequestIdRef = useRef(0);
  useEffect(() => {
    if (!focusSatellite) {
      setUpcomingPasses([]);
      setUpcomingPassesLoading(false);
      return;
    }

    const requestId = ++passRequestIdRef.current;
    setUpcomingPassesLoading(true);
    const passStart = new Date(passWindowKey * passWindowMs);
    predictPassesBulkStreaming(
      [focusSatellite],
      observer,
      {
        start: passStart,
        end: new Date(passStart.getTime() + 3 * 86400000),
        minElevationDeg: observer.minElevationDeg,
        stepSeconds: 45
      },
      () => {}
    )
      .then((passes) => {
        if (passRequestIdRef.current === requestId) {
          setUpcomingPasses(passes.slice(0, 4));
          setUpcomingPassesLoading(false);
        }
      })
      .catch(() => {
        if (passRequestIdRef.current === requestId) {
          setUpcomingPasses([]);
          setUpcomingPassesLoading(false);
        }
      });
  }, [focusSatellite, observer, passWindowKey, passWindowMs]);

  async function handleRefreshTle() {
    setRefreshStatus(null);
    try {
      await refreshSelectedSatellite();
      setRefreshIsError(false);
      setRefreshStatus("TLE refreshed.");
    } catch (caught) {
      setRefreshIsError(true);
      setRefreshStatus(caught instanceof Error ? caught.message : "Refresh failed.");
    }
  }

  function goLive() {
    clearTrackerPreviewRequest();
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

    const next = !timelinePlaying;
    if (next) {
      // Reset the tick baseline so the first playback tick does not jump by the paused gap.
      previousPlaybackTickRef.current = Date.now();
    }
    setTimelinePlaying(next);
  }

  function changePlaybackSpeed(value: number) {
    setPlaybackSpeed(value);
    if (timelineLive) {
      timelineAnchorRef.current = Date.now();
      previousPlaybackTickRef.current = Date.now();
      setTimelineOffsetMin(0);
      setTimelineLive(false);
      setTimelinePlaying(true);
    }
  }

  function setTimelineOffset(value: number) {
    clearTrackerPreviewRequest();
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
    } else if (event.key === "End") {
      event.preventDefault();
      setTimelineOffset(timelineRange.max);
    }
  }

  function inspectSatellite(id: string) {
    selectSatellite(id);
  }

  if (!focusSatellite || !selectedSnapshot || trackedSatellites.length === 0) {
    const propagationFailed = Boolean(focusSatellite) && (!selectedSnapshot || trackedSatellites.length === 0);
    return (
      <div className="panel p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Live tracker</h1>
        <p className="mt-2 text-[var(--muted)]">
          {propagationFailed
            ? `Could not propagate ${focusSatellite?.name ?? "the selected satellite"}. Its orbital elements may be stale or the object may have decayed - try "Update orbit data" on the Details page, or select another satellite.`
            : "Add a satellite in Catalog to start live tracking."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {propagationFailed && focusSatellite ? (
            <>
              <Button
                onClick={() => {
                  selectSatellite(focusSatellite.id);
                  setPage("details");
                }}
              >
                Open in Details
              </Button>
              {focusSatellite.id === selectedSatelliteId ? (
                <Button
                  variant="secondary"
                  title="Fetch fresh two-line elements (TLE) for this satellite"
                  onClick={() => void refreshSelectedSatellite()}
                >
                  Update orbit data
                </Button>
              ) : null}
            </>
          ) : (
            <Button onClick={() => setPage("catalog")}>Go to Catalog</Button>
          )}
        </div>
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
    <div className="tracker-page space-y-5">
      <div className="tracker-header flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Live tracker</p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-[var(--text)]">Orbital view</h1>
          <p className="mono mt-1.5 text-sm text-[var(--muted)]">
            Showing {trackedSatellites.length} satellite
            {trackedSatellites.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="tracker-view-toggle flex gap-2">
          <Button
            variant={trackerViewMode === "2d" ? "default" : "secondary"}
            aria-pressed={trackerViewMode === "2d"}
            onClick={() => setTrackerViewMode("2d")}
          >
            2D Map
          </Button>
          <Button
            variant={trackerViewMode === "3d" ? "default" : "secondary"}
            aria-pressed={trackerViewMode === "3d"}
            onClick={() => {
              setGlobeMounted(true);
              setTrackerViewMode("3d");
            }}
          >
            3D Globe
          </Button>
        </div>
      </div>

      <div className="tracker-satellite-list flex flex-wrap gap-2">
        {displayedTrackedSatellites.map((satellite) => {
          const selected = satellite.id === focusSatellite.id;
          return (
          <div
            key={satellite.id}
            className={clsx(
              "tracker-satellite-pill flex items-center gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]",
              selected && "selected"
            )}
          >
            <input
              className="satellite-color-picker"
              type="color"
              value={satellite.color}
              title="Change satellite color"
              aria-label={`Change ${satellite.name} color`}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => void setSatelliteColor(satellite.id, event.target.value)}
            />
            {/* The pill also holds a colour picker and Untrack, so the name button
                is the selectable control rather than the pill itself. */}
            <button
              type="button"
              className="link-button cursor-pointer"
              aria-pressed={selected}
              title="Inspect this satellite"
              onClick={() => inspectSatellite(satellite.id)}
            >
              {satellite.name}
            </button>
            <span className="mono text-xs text-[var(--faint)]">{satellite.noradId}</span>
            {watchlistIds.includes(satellite.id) ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={(event) => {
                  event.stopPropagation();
                  void untrackSatellite(satellite.id);
                }}
              >
                Untrack
              </Button>
            ) : (
              <span className="text-xs text-[var(--faint)]">selected</span>
            )}
          </div>
          );
        })}
        {trackedSatellites.length > COLLAPSED_TRACKED_LIST_COUNT ? (
          <Button
            className="tracker-satellite-more"
            variant="secondary"
            size="sm"
            onClick={() => setTrackedListExpanded((current) => !current)}
          >
            {trackedListExpanded ? "Show less" : `Show ${hiddenTrackedSatelliteCount} more`}
          </Button>
        ) : null}
      </div>

      {trackerPreviewRequest ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[rgba(108,140,255,0.35)] bg-[var(--accent-soft)] px-4 py-2.5">
          <p className="text-sm text-[var(--text)]">
            <span className="font-semibold">Pass preview</span>
            <span className="text-[var(--muted)]">
              {" · "}
              {selectedPass?.satelliteName ?? selectedSatellite?.name}
              {" · AOS "}
              {formatTimestamp(trackerPreviewRequest.startTime)}
              {selectedPass ? ` · LOS ${formatTimestamp(selectedPass.los)}` : ""}
            </span>
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                clearTrackerPreviewRequest();
                setPage("passes");
              }}
            >
              Back to passes
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                clearTrackerPreviewRequest();
                goLive();
              }}
            >
              Go live
            </Button>
          </div>
        </div>
      ) : null}

      <Card className="tracker-timeline rounded-[var(--radius-lg)] border-[var(--line)] bg-[var(--surface)] py-0 shadow-none">
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
              <div className="mono mt-1 text-xs text-[var(--muted)]">{formatTimestamp(currentTime)}</div>
            </div>

            <div className="tracker-timeline-actions flex flex-wrap items-center justify-end gap-2">
              <Button
                variant={showSunMoon ? "default" : "secondary"}
                size="sm"
                className="h-8"
                aria-pressed={showSunMoon}
                onClick={() => setShowSunMoon((current) => !current)}
              >
                <SunMoon size={14} />
                Sun/Moon
              </Button>
              <div className="tracker-speed-control grid w-[220px] grid-cols-[42px_1fr_48px] items-center gap-2 rounded-md border border-[var(--line-strong)] bg-[var(--surface-2)] px-3 py-2">
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
                aria-pressed={timelineLive}
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
      ) : null}
      {globeMounted ? (
        <div className={trackerViewMode === "3d" ? undefined : "hidden"}>
          <Globe3D
            observer={observer}
            satellites={trackedSatellites}
            currentTime={currentTime}
            showSunMoon={showSunMoon}
            onSatelliteDoubleClick={inspectSatellite}
            onFallbackTo2D={() => setTrackerViewMode("2d")}
          />
        </div>
      ) : null}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section ref={dataPanelRef} className="panel min-w-0 scroll-mt-16 p-4 sm:p-5 md:scroll-mt-14">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="label">Selected satellite</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-[var(--text)]">{focusSatellite.name}</h2>
              <p className="mono mt-1.5 text-sm text-[var(--muted)]">
                NORAD ID {focusSatellite.noradId}
                {focusSatellite.internationalDesignator ? ` · ${focusSatellite.internationalDesignator}` : ""}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="secondary"
                size="sm"
                disabled={refreshingSelected}
                title="Fetch fresh two-line elements (TLE) for this satellite"
                onClick={() => void handleRefreshTle()}
              >
                {refreshingSelected ? "Refreshing…" : "Update orbit data"}
              </Button>
              {refreshStatus ? (
                <p className={`mono text-xs ${refreshIsError ? "text-[var(--danger)]" : "text-[var(--accent)]"}`}>
                  {refreshStatus}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-[var(--text)]">Upcoming passes</h3>
              <span className="mono text-xs text-[var(--muted)]">Next 3 days</span>
            </div>
            <div className="mt-3 grid gap-2 sm:hidden">
              {upcomingPasses.map((pass) => (
                <div key={`${pass.satelliteId}-${pass.aos}`} className="panel-strong p-3">
                  <div className="mono text-sm text-[var(--text)]">{formatTimestampCompact(pass.aos)}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
                    <span>Max {pass.maxElevationDeg.toFixed(1)}°</span>
                    <span>{formatDuration(pass.durationSec)}</span>
                    <span className="mono">
                      {pass.aosAzimuthDeg.toFixed(0)}° → {pass.losAzimuthDeg.toFixed(0)}°
                    </span>
                  </div>
                </div>
              ))}
              {upcomingPasses.length === 0 ? (
                upcomingPassesLoading ? (
                  <p className="mono py-4 text-center text-sm text-[var(--muted)]" role="status">
                    Finding upcoming passes…
                  </p>
                ) : (
                  <p className="py-4 text-center text-sm text-[var(--muted)]">
                    No passes above {observer.minElevationDeg.toFixed(0)}° in the next 3 days.
                    Lower the minimum elevation in Settings to widen the search.
                  </p>
                )
              ) : null}
            </div>
            <div className="mt-3 hidden overflow-auto sm:block">
              <table>
                <thead>
                  <tr>
                    <th title="Acquisition of signal — pass start">Start (AOS)</th>
                    <th>Max El</th>
                    <th>Duration</th>
                    <th>Azimuth</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingPasses.map((pass) => (
                    <tr key={`${pass.satelliteId}-${pass.aos}`}>
                      <td className="mono whitespace-nowrap">{formatTimestampCompact(pass.aos)}</td>
                      <td className="whitespace-nowrap">{pass.maxElevationDeg.toFixed(1)}°</td>
                      <td className="whitespace-nowrap">{formatDuration(pass.durationSec)}</td>
                      <td className="mono whitespace-nowrap">
                        {pass.aosAzimuthDeg.toFixed(0)}°{" → "}{pass.losAzimuthDeg.toFixed(0)}°
                      </td>
                    </tr>
                  ))}
                  {upcomingPasses.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-5 text-center text-sm text-[var(--muted)]">
                        {upcomingPassesLoading ? (
                          <span className="mono" role="status">Finding upcoming passes…</span>
                        ) : (
                          <>
                            No passes above {observer.minElevationDeg.toFixed(0)}° in the next 3 days.
                            Lower the minimum elevation in Settings to widen the search.
                          </>
                        )}
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

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
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
          <div key={label} className="panel-strong p-3 sm:p-4">
            <div className="text-xs font-medium text-[var(--faint)]">{label}</div>
            <div className="mono mt-1.5 text-base text-[var(--text)] sm:text-xl">{value}</div>
          </div>
        ))}
      </div>

    </div>
  );
}
