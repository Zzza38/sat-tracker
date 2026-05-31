import { useMemo, useRef, useState } from "react";
import { getMoonSubpoint, getSunSubpoint } from "@/shared/astro/lighting";
import { GroundTrackPoint } from "@/shared/types";
import { Button } from "./ui/button";
import { WORLD_HEIGHT, WORLD_MAP_ASSET_URL, WORLD_WIDTH, projectLonLat } from "./worldMap";

export interface TrackedSatelliteView {
  id: string;
  name: string;
  noradId: string;
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
  groundTrack: GroundTrackPoint[];
  selected: boolean;
  color: string;
}

interface Map2DProps {
  observer: { latitude: number; longitude: number };
  satellites: TrackedSatelliteView[];
  currentTime: Date;
  showSunMoon: boolean;
}

interface ProjectedPoint {
  x: number;
  y: number;
}

interface UnwrappablePoint {
  latitudeDeg: number;
  longitudeDeg: number;
}

const EARTH_RADIUS_KM = 6371;
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampPanY(value: number, zoom: number) {
  if (zoom <= 1) {
    return 0;
  }

  return clamp(value, WORLD_HEIGHT - WORLD_HEIGHT * zoom, 0);
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

export function Map2D({ observer, satellites, currentTime, showSunMoon }: Map2DProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const [viewport, setViewport] = useState({ panX: 0, panY: 0, zoom: 1 });
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

  function toViewBoxPoint(clientX: number, clientY: number) {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) {
      return { x: 0, y: 0 };
    }

    return {
      x: ((clientX - bounds.left) / bounds.width) * WORLD_WIDTH,
      y: ((clientY - bounds.top) / bounds.height) * WORLD_HEIGHT
    };
  }

  function zoomBy(factor: number, anchor = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 }) {
    setViewport((current) => {
      const nextZoom = clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const worldX = (anchor.x - current.panX) / current.zoom;
      const worldY = (anchor.y - current.panY) / current.zoom;
      return {
        zoom: nextZoom,
        panX: anchor.x - worldX * nextZoom,
        panY: clampPanY(anchor.y - worldY * nextZoom, nextZoom)
      };
    });
  }

  const markerScale = 1 / viewport.zoom;

  return (
    <section className="relative h-[520px] w-full select-none overflow-hidden rounded-[10px] border border-[var(--line)] bg-[#0b0f14]">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`}
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        role="img"
        aria-label="World map with satellite ground track"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            panX: viewport.panX,
            panY: viewport.panY
          };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId || !svgRef.current) {
            return;
          }
          event.preventDefault();

          const bounds = svgRef.current.getBoundingClientRect();
          const dx = ((event.clientX - drag.x) / bounds.width) * WORLD_WIDTH;
          const dy = ((event.clientY - drag.y) / bounds.height) * WORLD_HEIGHT;
          setViewport((current) => ({
            ...current,
            panX: drag.panX + dx,
            panY: clampPanY(drag.panY + dy, current.zoom)
          }));
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onWheel={(event) => {
          event.preventDefault();
          const anchor = toViewBoxPoint(event.clientX, event.clientY);
          zoomBy(event.deltaY < 0 ? 1.18 : 1 / 1.18, anchor);
        }}
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
                  {satelliteViews.map((satellite) => (
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
                  <g key={`${copy}-${satellite.id}`} transform={`translate(${satellite.point.x} ${satellite.point.y}) scale(${markerScale})`}>
                    <circle r={satellite.selected ? "10" : "7"} fill={satellite.color} filter="url(#markerGlow)" />
                    <circle r={satellite.selected ? "16" : "12"} fill="none" stroke={satellite.color} strokeOpacity="0.68" strokeWidth="2.5" />
                    <text x="16" y="-12" fill="#eef2f0" fontSize="16" fontWeight="700">
                      {satellite.name}
                    </text>
                    <text x="16" y="7" fill="#9aa8b7" fontSize="12" fontFamily="IBM Plex Mono, monospace">
                      NORAD ID {satellite.noradId}
                    </text>
                  </g>
                ))}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="pointer-events-none absolute right-3 top-3 flex gap-2">
        <Button className="pointer-events-auto" variant="secondary" size="xs" onClick={() => zoomBy(1.18)}>
          +
        </Button>
        <Button className="pointer-events-auto" variant="secondary" size="xs" onClick={() => zoomBy(1 / 1.18)}>
          -
        </Button>
        <Button className="pointer-events-auto" variant="secondary" size="xs" onClick={() => setViewport({ panX: 0, panY: 0, zoom: 1 })}>
          Reset
        </Button>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 flex gap-3 rounded-[10px] border border-[var(--line)] bg-black/35 px-3 py-2 text-xs text-[var(--muted)] backdrop-blur">
        {satellites.slice(0, 3).map((satellite) => (
          <span key={satellite.id} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: satellite.color }} />
            {satellite.name}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#e0a458]" />
          Observer
        </span>
      </div>
    </section>
  );
}
