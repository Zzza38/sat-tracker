import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, Minus, Plus, RotateCcw } from "lucide-react";
import { getMoonSubpoint, getSunSubpoint } from "@/shared/astro/lighting";
import { GroundTrackPoint } from "@/shared/types";
import { Button } from "./ui/button";
import {
  MAX_ZOOM,
  clientDeltaToViewBox,
  clientToViewBox,
  panViewport,
  pointerDistance,
  pointerMidpoint,
  zoomViewport,
  type MapViewport
} from "./mapViewport";
import { WORLD_HEIGHT, WORLD_MAP_ASSET_URL, WORLD_WIDTH, projectLonLat } from "./worldMap";

export interface TrackedSatelliteView {
  id: string;
  name: string;
  noradId: string;
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
  azimuthDeg: number;
  elevationDeg: number;
  rangeKm: number;
  groundTrack: GroundTrackPoint[];
  selected: boolean;
  color: string;
}

interface Map2DProps {
  observer: { latitude: number; longitude: number };
  satellites: TrackedSatelliteView[];
  currentTime: Date;
  showSunMoon: boolean;
  onSatelliteDoubleClick?: (satelliteId: string) => void;
}

interface ProjectedPoint {
  x: number;
  y: number;
}

interface UnwrappablePoint {
  latitudeDeg: number;
  longitudeDeg: number;
}

type ActiveGesture =
  | {
      kind: "pan";
      pointerId: number;
      x: number;
      y: number;
      panX: number;
      panY: number;
    }
  | {
      kind: "pinch";
      pointers: Map<number, { clientX: number; clientY: number }>;
      distance: number;
      midpoint: { clientX: number; clientY: number };
      viewport: MapViewport;
    };

const EARTH_RADIUS_KM = 6371;
const EQUINOX_DECLINATION_EPSILON_DEG = 0.1;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_MAX_DISTANCE_PX = 28;
const DEFAULT_VIEWPORT: MapViewport = { panX: 0, panY: 0, zoom: 1 };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function projectedPath(points: ProjectedPoint[], closePath = false) {
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");

  return closePath ? `${path} Z` : path;
}

function unwrapLongitudes<T extends UnwrappablePoint>(points: T[]) {
  return points.reduce<T[]>((unwrapped, point) => {
    const previous = unwrapped.at(-1);
    if (!previous) {
      unwrapped.push(point);
      return unwrapped;
    }

    let longitudeDeg = point.longitudeDeg;
    while (longitudeDeg - previous.longitudeDeg > 180) {
      longitudeDeg -= 360;
    }
    while (previous.longitudeDeg - longitudeDeg > 180) {
      longitudeDeg += 360;
    }

    unwrapped.push({ ...point, longitudeDeg });
    return unwrapped;
  }, []);
}

function projectUnwrappedPoint(point: UnwrappablePoint): ProjectedPoint {
  return {
    x: ((point.longitudeDeg + 180) / 360) * WORLD_WIDTH,
    y: ((90 - point.latitudeDeg) / 180) * WORLD_HEIGHT
  };
}

function trackPath(points: GroundTrackPoint[]) {
  return projectedPath(unwrapLongitudes(points).map(projectUnwrappedPoint));
}

function normalizeLongitude(longitudeDeg: number) {
  let longitude = ((longitudeDeg + 180) % 360 + 360) % 360 - 180;
  if (longitude === -180) {
    longitude = 180;
  }
  return longitude;
}

function terminatorLatitude(longitudeDeg: number, sun: { latitudeDeg: number; longitudeDeg: number }) {
  const declination = sun.latitudeDeg * RAD;
  const hourAngle = (longitudeDeg - sun.longitudeDeg) * RAD;
  const latitude = Math.atan(-Math.cos(hourAngle) / Math.tan(declination)) * DEG;

  return clamp(latitude, -90, 90);
}

function getTerminatorPoints(sun: { latitudeDeg: number; longitudeDeg: number }, resolution = 2) {
  return Array.from({ length: 360 * resolution + 1 }, (_, index) => {
    const longitudeDeg = -180 + index / resolution;

    return {
      latitudeDeg: terminatorLatitude(longitudeDeg, sun),
      longitudeDeg
    };
  });
}

function getNightOverlay(
  sun: { latitudeDeg: number; longitudeDeg: number },
  resolution = 2
) {
  if (Math.abs(sun.latitudeDeg) < EQUINOX_DECLINATION_EPSILON_DEG) {
    const antiSolarLongitude = normalizeLongitude(sun.longitudeDeg + 180);
    const westLongitude = antiSolarLongitude - 90;
    const eastLongitude = antiSolarLongitude + 90;
    const westTop = projectUnwrappedPoint({ latitudeDeg: 90, longitudeDeg: westLongitude });
    const westBottom = projectUnwrappedPoint({ latitudeDeg: -90, longitudeDeg: westLongitude });
    const eastTop = projectUnwrappedPoint({ latitudeDeg: 90, longitudeDeg: eastLongitude });
    const eastBottom = projectUnwrappedPoint({ latitudeDeg: -90, longitudeDeg: eastLongitude });

    return {
      terminatorPath: [
        `M ${westTop.x.toFixed(1)} ${westTop.y.toFixed(1)}`,
        `L ${westBottom.x.toFixed(1)} ${westBottom.y.toFixed(1)}`,
        `M ${eastTop.x.toFixed(1)} ${eastTop.y.toFixed(1)}`,
        `L ${eastBottom.x.toFixed(1)} ${eastBottom.y.toFixed(1)}`
      ].join(" "),
      nightPath: projectedPath([westTop, eastTop, eastBottom, westBottom], true)
    };
  }

  const terminator = getTerminatorPoints(sun, resolution);
  const poleLatitude = sun.latitudeDeg < 0 ? 90 : -90;
  const polygonPoints = [
    { latitudeDeg: poleLatitude, longitudeDeg: -180 },
    ...terminator,
    { latitudeDeg: poleLatitude, longitudeDeg: 180 }
  ];

  return {
    terminatorPath: projectedPath(terminator.map(projectUnwrappedPoint)),
    nightPath: projectedPath(polygonPoints.map(projectUnwrappedPoint), true)
  };
}

function footprintSize(satellite: TrackedSatelliteView) {
  const horizonAngleDeg =
    (Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + Math.max(satellite.altitudeKm, 1))) * 180) /
    Math.PI;

  return {
    rx: (horizonAngleDeg / 360) * WORLD_WIDTH,
    ry: (horizonAngleDeg / 180) * WORLD_HEIGHT
  };
}

function worldCopyRange(panX: number, zoom: number) {
  const visibleLeft = -panX / zoom;
  const visibleRight = (WORLD_WIDTH - panX) / zoom;
  const start = Math.floor(visibleLeft / WORLD_WIDTH) - 1;
  const end = Math.ceil(visibleRight / WORLD_WIDTH) + 1;
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function Map2D({
  observer,
  satellites,
  currentTime,
  showSunMoon,
  onSatelliteDoubleClick
}: Map2DProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gestureRef = useRef<ActiveGesture | null>(null);
  const viewportRef = useRef<MapViewport>(DEFAULT_VIEWPORT);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const [viewport, setViewport] = useState<MapViewport>(DEFAULT_VIEWPORT);
  const [expanded, setExpanded] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [gestureHintVisible, setGestureHintVisible] = useState(false);
  const worldCopies = useMemo(
    () => worldCopyRange(viewport.panX, viewport.zoom),
    [viewport.panX, viewport.zoom]
  );
  const observerPoint = projectLonLat([observer.longitude, observer.latitude]);
  const sunSubpoint = useMemo(() => getSunSubpoint(currentTime), [currentTime]);
  const sunPoint = useMemo(() => {
    return projectLonLat([sunSubpoint.longitudeDeg, sunSubpoint.latitudeDeg]);
  }, [sunSubpoint]);
  const moonPoint = useMemo(() => {
    const moon = getMoonSubpoint(currentTime);
    return projectLonLat([moon.longitudeDeg, moon.latitudeDeg]);
  }, [currentTime]);
  const nightOverlay = useMemo(() => getNightOverlay(sunSubpoint, 3), [sunSubpoint]);
  const satelliteViews = useMemo(
    () =>
      satellites.map((satellite) => ({
        ...satellite,
        point: projectLonLat([satellite.longitudeDeg, satellite.latitudeDeg]),
        groundTrackPath: trackPath(satellite.groundTrack),
        footprint: footprintSize(satellite)
      })),
    [satellites]
  );
  const showSatelliteLabels = satellites.length <= 20;
  const showSatelliteFootprints = satellites.length <= 30;
  viewportRef.current = viewport;

  function updateViewport(next: MapViewport | ((current: MapViewport) => MapViewport)) {
    setViewport((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      viewportRef.current = resolved;
      return resolved;
    });
  }

  function zoomBy(factor: number, anchor = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 }) {
    updateViewport((current) => zoomViewport(current, factor, anchor));
  }

  function resetViewport() {
    updateViewport(DEFAULT_VIEWPORT);
  }

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = svg.getBoundingClientRect();
      const anchor = clientToViewBox(bounds, event.clientX, event.clientY);
      zoomBy(event.deltaY < 0 ? 1.18 : 1 / 1.18, anchor);
    };
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    if (!expanded) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const coarse = window.matchMedia("(hover: none), (pointer: coarse)").matches;
    if (!coarse) {
      return;
    }

    const storageKey = "sat-tracker.map-gesture-hint-seen";
    try {
      if (window.localStorage.getItem(storageKey) === "1") {
        return;
      }
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Ignore storage failures and still show the hint once per session.
    }

    setGestureHintVisible(true);
    const timer = window.setTimeout(() => setGestureHintVisible(false), 3200);
    return () => window.clearTimeout(timer);
  }, []);

  function beginPan(pointerId: number, clientX: number, clientY: number) {
    const current = viewportRef.current;
    gestureRef.current = {
      kind: "pan",
      pointerId,
      x: clientX,
      y: clientY,
      panX: current.panX,
      panY: current.panY
    };
  }

  function beginPinch(
    pointers: Map<number, { clientX: number; clientY: number }>
  ) {
    const [a, b] = [...pointers.values()];
    if (!a || !b) {
      return;
    }

    gestureRef.current = {
      kind: "pinch",
      pointers: new Map(pointers),
      distance: Math.max(pointerDistance(a, b), 1),
      midpoint: pointerMidpoint(a, b),
      viewport: viewportRef.current
    };
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if ((event.target as Element).closest("[data-satellite-marker]")) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const active = gestureRef.current;
    if (active?.kind === "pan" && active.pointerId !== event.pointerId) {
      const pointers = new Map<number, { clientX: number; clientY: number }>([
        [active.pointerId, { clientX: active.x, clientY: active.y }],
        [event.pointerId, { clientX: event.clientX, clientY: event.clientY }]
      ]);
      beginPinch(pointers);
      lastTapRef.current = null;
      return;
    }

    if (active?.kind === "pinch") {
      active.pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      beginPinch(active.pointers);
      return;
    }

    const now = performance.now();
    const lastTap = lastTapRef.current;
    if (
      lastTap &&
      now - lastTap.time <= DOUBLE_TAP_MS &&
      Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) <= DOUBLE_TAP_MAX_DISTANCE_PX
    ) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const anchor = clientToViewBox(bounds, event.clientX, event.clientY);
      zoomBy(viewportRef.current.zoom >= MAX_ZOOM - 0.01 ? 1 / MAX_ZOOM : 1.7, anchor);
      lastTapRef.current = null;
      gestureRef.current = null;
      return;
    }

    lastTapRef.current = { time: now, x: event.clientX, y: event.clientY };
    setGestureHintVisible(false);
    beginPan(event.pointerId, event.clientX, event.clientY);
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const gesture = gestureRef.current;
    if (!gesture || !svgRef.current) {
      return;
    }

    event.preventDefault();
    const bounds = svgRef.current.getBoundingClientRect();

    if (gesture.kind === "pan") {
      if (gesture.pointerId !== event.pointerId) {
        return;
      }

      const delta = clientDeltaToViewBox(bounds, event.clientX - gesture.x, event.clientY - gesture.y);
      updateViewport(
        panViewport(
          {
            zoom: viewportRef.current.zoom,
            panX: gesture.panX,
            panY: gesture.panY
          },
          delta.x,
          delta.y
        )
      );
      return;
    }

    if (!gesture.pointers.has(event.pointerId)) {
      return;
    }

    gesture.pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    if (gesture.pointers.size < 2) {
      return;
    }

    const [a, b] = [...gesture.pointers.values()];
    if (!a || !b) {
      return;
    }

    const distance = Math.max(pointerDistance(a, b), 1);
    const midpoint = pointerMidpoint(a, b);
    const factor = distance / gesture.distance;
    const anchor = clientToViewBox(bounds, gesture.midpoint.clientX, gesture.midpoint.clientY);
    const zoomed = zoomViewport(gesture.viewport, factor, anchor);
    const midDelta = clientDeltaToViewBox(
      bounds,
      midpoint.clientX - gesture.midpoint.clientX,
      midpoint.clientY - gesture.midpoint.clientY
    );
    updateViewport(panViewport(zoomed, midDelta.x, midDelta.y));
  }

  function endPointer(event: ReactPointerEvent<SVGSVGElement>) {
    const gesture = gestureRef.current;
    if (!gesture) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (gesture.kind === "pan") {
      if (gesture.pointerId === event.pointerId) {
        gestureRef.current = null;
      }
      return;
    }

    gesture.pointers.delete(event.pointerId);
    if (gesture.pointers.size >= 2) {
      beginPinch(gesture.pointers);
      return;
    }

    if (gesture.pointers.size === 1) {
      const [pointerId, point] = [...gesture.pointers.entries()][0]!;
      beginPan(pointerId, point.clientX, point.clientY);
      return;
    }

    gestureRef.current = null;
  }

  const markerScale = 1 / viewport.zoom;
  const legendItems = [
    ...satellites.slice(0, 3).map((satellite) => ({
      id: satellite.id,
      name: satellite.name,
      color: satellite.color
    })),
    ...(satellites.length > 3
      ? [{ id: "more", name: `+${satellites.length - 3} more`, color: "transparent" }]
      : []),
    { id: "observer", name: "Observer", color: "#e0a458" }
  ];

  const mapSection = (
    <section
      className={`tracker-map-section relative h-[380px] w-full select-none overflow-hidden rounded-[10px] border border-[var(--line)] bg-[#0b0f14] sm:h-[460px] lg:h-[520px]${
        expanded ? " tracker-map-section-expanded" : ""
      }`}
      data-expanded={expanded ? "true" : "false"}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`}
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        role="img"
        aria-label="World map with satellite ground track. Drag to pan, pinch or double-tap to zoom."
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <defs>
          <linearGradient id="oceanGradient" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#101722" />
            <stop offset="55%" stopColor="#0d1219" />
            <stop offset="100%" stopColor="#090d12" />
          </linearGradient>
          <filter id="markerGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect width={WORLD_WIDTH} height={WORLD_HEIGHT} fill="url(#oceanGradient)" />

        <g transform={`translate(${viewport.panX} ${viewport.panY}) scale(${viewport.zoom})`}>
          {worldCopies.map((copy) => {
            const offsetX = copy * WORLD_WIDTH;
            return (
              <g key={`world-copy-${copy}`} transform={`translate(${offsetX} 0)`}>
                <g opacity="0.32" stroke="#334050" strokeWidth="1">
                  {Array.from({ length: 11 }, (_, index) => -150 + index * 30).map((longitude) => {
                    const { x } = projectLonLat([longitude, 0]);
                    return <line key={`lon-${copy}-${longitude}`} x1={x} x2={x} y1="0" y2={WORLD_HEIGHT} />;
                  })}
                  {Array.from({ length: 5 }, (_, index) => -60 + index * 30).map((latitude) => {
                    const { y } = projectLonLat([0, latitude]);
                    return <line key={`lat-${copy}-${latitude}`} x1="0" x2={WORLD_WIDTH} y1={y} y2={y} />;
                  })}
                </g>

                <image href={WORLD_MAP_ASSET_URL} width={WORLD_WIDTH} height={WORLD_HEIGHT} opacity="0.92" />

                {showSunMoon ? (
                  <g>
                    <path d={nightOverlay.nightPath} fill="#02040a" opacity="0.3" />
                    <path
                      d={nightOverlay.terminatorPath}
                      fill="none"
                      stroke="#f8fafc"
                      strokeDasharray={`${5 * markerScale} ${6 * markerScale}`}
                      strokeLinecap="round"
                      strokeOpacity="0.72"
                      strokeWidth={1.5 * markerScale}
                    />
                    <g transform={`translate(${sunPoint.x} ${sunPoint.y}) scale(${markerScale})`}>
                      <circle r="11" fill="#ffd76a" opacity="0.16" />
                      <circle r="4.5" fill="#ffd76a" />
                      <text x="10" y="4" fill="#ffe7a1" fontSize="11" fontWeight="600">
                        Sun
                      </text>
                    </g>
                    <g transform={`translate(${moonPoint.x} ${moonPoint.y}) scale(${markerScale})`}>
                      <circle r="4.5" fill="#d9e1f2" />
                      <circle r="8" fill="none" stroke="#d9e1f2" strokeOpacity="0.34" strokeWidth="1.5" />
                      <text x="10" y="4" fill="#d9e1f2" fontSize="11" fontWeight="600">
                        Moon
                      </text>
                    </g>
                  </g>
                ) : null}

                <g strokeWidth="1.5">
                  {satelliteViews
                    .filter((satellite) => showSatelliteFootprints || satellite.selected)
                    .map((satellite) => (
                    <ellipse
                      key={`${copy}-${satellite.id}-footprint`}
                      cx={satellite.point.x}
                      cy={satellite.point.y}
                      rx={satellite.footprint.rx}
                      ry={satellite.footprint.ry}
                      fill={satellite.color}
                      fillOpacity="0.1"
                      stroke={satellite.color}
                      strokeOpacity="0.5"
                    />
                  ))}
                </g>

                <g fill="none" strokeLinecap="round" strokeLinejoin="round">
                  {satelliteViews.map((satellite) => (
                    <path
                      key={`${copy}-${satellite.id}-track`}
                      d={satellite.groundTrackPath}
                      stroke={satellite.color}
                      strokeWidth={(satellite.selected ? 3 : 2) * markerScale}
                      opacity={satellite.selected ? "0.92" : "0.55"}
                    />
                  ))}
                </g>

                <g>
                  <g transform={`translate(${observerPoint.x} ${observerPoint.y}) scale(${markerScale})`}>
                    <circle r="9" fill="#e0a458" filter="url(#markerGlow)" />
                    <circle r="13" fill="none" stroke="#f4c47d" strokeOpacity="0.55" strokeWidth="2" />
                    <text x="16" y="5" fill="#d6d8dd" fontSize="18" fontWeight="600">
                      Observer
                    </text>
                  </g>
                </g>

                {satelliteViews.map((satellite) => (
                  <g
                    key={`${copy}-${satellite.id}`}
                    className="cursor-pointer"
                    data-satellite-marker
                    role="button"
                    tabIndex={0}
                    aria-label={`Inspect ${satellite.name}`}
                    transform={`translate(${satellite.point.x} ${satellite.point.y}) scale(${markerScale})`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onSatelliteDoubleClick?.(satellite.id);
                    }}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onSatelliteDoubleClick?.(satellite.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        onSatelliteDoubleClick?.(satellite.id);
                      }
                    }}
                  >
                    <title>{`Tap to inspect ${satellite.name}`}</title>
                    <circle r={satellite.selected ? "10" : "7"} fill={satellite.color} filter="url(#markerGlow)" />
                    <circle r={satellite.selected ? "16" : "12"} fill="none" stroke={satellite.color} strokeOpacity="0.68" strokeWidth="2.5" />
                    {showSatelliteLabels || satellite.selected ? (
                      <>
                        <text x="16" y="-12" fill="#eef2f0" fontSize="16" fontWeight="700">
                          {satellite.name}
                        </text>
                        <text x="16" y="7" fill="#9aa8b7" fontSize="12" fontFamily="IBM Plex Mono, monospace">
                          NORAD ID {satellite.noradId}
                        </text>
                      </>
                    ) : null}
                  </g>
                ))}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="tracker-map-chrome pointer-events-none absolute inset-0 z-10 p-2.5 sm:p-3">
        <div className="tracker-map-zoom-badge absolute left-2.5 top-2.5 rounded-md border border-[var(--line)] bg-black/45 px-2 py-1 font-mono text-[0.68rem] text-[var(--muted)] backdrop-blur sm:left-3 sm:top-3">
          {viewport.zoom.toFixed(1)}x
        </div>

        <button
          type="button"
          className="tracker-map-legend-toggle pointer-events-auto absolute left-2.5 top-11 sm:left-3"
          aria-expanded={legendOpen}
          onClick={() => {
            setLegendOpen((current) => !current);
            setGestureHintVisible(false);
          }}
        >
          Legend
        </button>

        <div className="tracker-map-control-stack pointer-events-auto absolute right-2.5 top-2.5 flex flex-col gap-1.5 sm:right-3 sm:top-3">
          <Button
            className="tracker-map-control-btn"
            variant="secondary"
            size="icon-sm"
            aria-label="Zoom in"
            onClick={() => zoomBy(1.18)}
          >
            <Plus />
          </Button>
          <Button
            className="tracker-map-control-btn"
            variant="secondary"
            size="icon-sm"
            aria-label="Zoom out"
            onClick={() => zoomBy(1 / 1.18)}
          >
            <Minus />
          </Button>
          <Button
            className="tracker-map-control-btn"
            variant="secondary"
            size="icon-sm"
            aria-label="Reset map view"
            onClick={resetViewport}
          >
            <RotateCcw />
          </Button>
          <Button
            className="tracker-map-control-btn tracker-map-expand-btn"
            variant="secondary"
            size="icon-sm"
            aria-label={expanded ? "Exit full map" : "Open full map"}
            aria-pressed={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </div>

        <div
          className={`tracker-map-legend absolute bottom-2.5 left-2.5 right-2.5 rounded-[10px] border border-[var(--line)] bg-black/45 text-xs text-[var(--muted)] backdrop-blur sm:bottom-3 sm:left-3 sm:right-auto ${
            legendOpen ? "tracker-map-legend-open" : ""
          }`}
        >
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 px-3 py-2">
            {legendItems.map((item) => (
              <span key={item.id} className="inline-flex items-center gap-1.5">
                {item.color !== "transparent" ? (
                  <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                ) : null}
                {item.name}
              </span>
            ))}
          </div>
        </div>

        {gestureHintVisible ? (
          <div className="tracker-map-gesture-hint absolute inset-x-0 bottom-3 flex justify-center px-4">
            <p className="rounded-full border border-[var(--line)] bg-black/55 px-3 py-1.5 text-center text-[0.72rem] text-[var(--text)] backdrop-blur">
              Drag to pan · Pinch or double-tap to zoom
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );

  if (expanded && typeof document !== "undefined") {
    return (
      <>
        <div
          className="tracker-map-section tracker-map-section-placeholder h-[380px] w-full sm:h-[460px] lg:h-[520px]"
          aria-hidden="true"
        />
        {createPortal(mapSection, document.body)}
      </>
    );
  }

  return mapSection;
}
