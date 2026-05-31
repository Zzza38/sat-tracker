import { useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Pause, Play, RotateCcw, SunMoon } from "lucide-react";
import { buildGroundTrack, computeOrbitSnapshot } from "@/shared/propagation/engine";
import { useApp } from "../context/AppContext";
import { useTicker } from "../hooks/useTicker";
import { DopplerPanel } from "../components/DopplerPanel";
import { Globe3D } from "../components/Globe3D";
import { Map2D, type TrackedSatelliteView } from "../components/Map2D";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Slider } from "../components/ui/slider";

const TRACK_WINDOW_MINUTES = 180;
const TRACK_STEP_SECONDS = 60;
const TIMELINE_MIN_MINUTES = -180;
const TIMELINE_MAX_MINUTES = 180;
const TIMELINE_STEP_MINUTES = 5;

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

function clampTimelineOffset(minutes: number) {
  return Math.min(TIMELINE_MAX_MINUTES, Math.max(TIMELINE_MIN_MINUTES, minutes));
}

export function TrackerPage() {
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
    getSatelliteColor,
    setSatelliteColor,
    updateSatelliteFrequencies
  } = useApp();
  const visibleSatellites = useMemo(() => {
    if (watchlistIds.length > 0) {
      const ids = new Set(watchlistIds);
      return satellites.filter((satellite) => ids.has(satellite.id));
    }

    return selectedSatellite ? [selectedSatellite] : [];
  }, [satellites, selectedSatellite, watchlistIds]);
  const visibleSatelliteIds = useMemo(
    () => visibleSatellites.map((satellite) => satellite.id),
    [visibleSatellites]
  );
  const timelineAnchorRef = useRef(Date.now());
  const [timelineOffsetMin, setTimelineOffsetMin] = useState(0);
  const [timelineLive, setTimelineLive] = useState(true);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [showSunMoon, setShowSunMoon] = useState(true);
  const liveNow = useTicker(1000 / 30);
  const playbackNow = useTicker(1000 / 30);
  const previousPlaybackTickRef = useRef(playbackNow.getTime());
  const currentTime = useMemo(
    () =>
      timelineLive
        ? liveNow
        : new Date(timelineAnchorRef.current + timelineOffsetMin * 60000),
    [liveNow, timelineLive, timelineOffsetMin]
  );
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
          observer,
          trackStart,
          TRACK_WINDOW_MINUTES + 1,
          TRACK_STEP_SECONDS
        )
      ])
    );
  }, [observer, trackStart, visibleSatellites]);

  useEffect(() => {
    const previous = previousPlaybackTickRef.current;
    const next = playbackNow.getTime();
    previousPlaybackTickRef.current = next;

    if (!timelinePlaying || timelineLive) {
      return;
    }

    const elapsedMinutes = ((next - previous) / 60000) * playbackSpeed;
    setTimelineOffsetMin((current) => clampTimelineOffset(current + elapsedMinutes));
  }, [playbackNow, playbackSpeed, timelineLive, timelinePlaying]);

  useEffect(() => {
    if (!trackerPreviewRequest) {
      return;
    }

    const previewAnchor = Date.now();
    timelineAnchorRef.current = previewAnchor;
    previousPlaybackTickRef.current = previewAnchor;
    setTimelineOffsetMin(
      clampTimelineOffset((new Date(trackerPreviewRequest.startTime).getTime() - previewAnchor) / 60000)
    );
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
          groundTrack: groundTracksById.get(satellite.id) ?? [],
          selected: satellite.id === selectedSatelliteId,
          color: getSatelliteColor(satellite.id, visibleSatelliteIds)
        };
      }),
    [currentTime, getSatelliteColor, groundTracksById, observer, selectedSatelliteId, visibleSatelliteIds, visibleSatellites]
  );

  const focusSatellite =
    selectedSatellite && visibleSatellites.some((satellite) => satellite.id === selectedSatellite.id)
      ? selectedSatellite
      : visibleSatellites[0];
  const selectedTrackedSatellite = trackedSatellites.find((satellite) => satellite.id === focusSatellite?.id);
  const selectedSnapshot = useMemo(() => {
    if (!focusSatellite) {
      return null;
    }

    return computeOrbitSnapshot(focusSatellite, currentTime, observer);
  }, [currentTime, focusSatellite, observer]);

  function goLive() {
    timelineAnchorRef.current = Date.now();
    setTimelineOffsetMin(0);
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

  if (!focusSatellite || !selectedSnapshot || trackedSatellites.length === 0) {
    return (
      <div className="panel p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Live tracker</h1>
        <p className="mt-2 text-[var(--muted)]">Add a satellite in Catalog to start live tracking.</p>
      </div>
    );
  }

  async function untrackSatellite(id: string) {
    if (watchlistIds.includes(id)) {
      await toggleWatchlist(id);
    }

    if (id === selectedSatelliteId) {
      selectSatellite(watchlistIds.find((watchlistId) => watchlistId !== id) ?? null);
    }
  }

  const visibleTimelineOffsetMin = timelineLive ? 0 : timelineOffsetMin;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Live tracker</p>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">{focusSatellite.name}</h1>
          <p className="mono mt-1.5 text-sm text-[var(--muted)]">
            NORAD ID {focusSatellite.noradId} · showing {trackedSatellites.length} satellite
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
            className="flex items-center gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
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
            <span className="mono text-xs text-[var(--faint)]">{formatTimelineOffset(TIMELINE_MIN_MINUTES)}</span>
            <div className="relative flex min-h-5 items-center">
              <Slider
                min={TIMELINE_MIN_MINUTES}
                max={TIMELINE_MAX_MINUTES}
                step={TIMELINE_STEP_MINUTES}
                value={[visibleTimelineOffsetMin]}
                aria-label="Timeline offset"
                onValueChange={([value]) => {
                  setTimelineLive(false);
                  setTimelinePlaying(false);
                  setTimelineOffsetMin(clampTimelineOffset(value ?? 0));
                }}
                className="w-full"
              />
              <div
                className="pointer-events-none absolute left-1/2 top-1/2 z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--bg)] bg-[var(--success)] shadow-[0_0_0_2px_rgba(101,189,142,0.22)]"
                aria-hidden="true"
              />
            </div>
            <span className="mono text-right text-xs text-[var(--faint)]">{formatTimelineOffset(TIMELINE_MAX_MINUTES)}</span>
          </div>
        </CardContent>
      </Card>

      <div className={trackerViewMode === "2d" ? "block" : "hidden"}>
        <Map2D
          observer={{ latitude: observer.latitude, longitude: observer.longitude }}
          satellites={trackedSatellites}
          currentTime={currentTime}
          showSunMoon={showSunMoon}
        />
      </div>
      <div className={trackerViewMode === "3d" ? "block" : "hidden"}>
        <Globe3D
          observer={observer}
          satellites={trackedSatellites}
          currentTime={currentTime}
          showSunMoon={showSunMoon}
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

      <DopplerPanel
        dopplerFactor={selectedSnapshot.dopplerFactor}
        downlinkHz={focusSatellite.frequencies?.downlinkHz}
        onDownlinkHzChange={(downlinkHz) =>
          void updateSatelliteFrequencies(focusSatellite.id, { downlinkHz })
        }
      />
    </div>
  );
}
