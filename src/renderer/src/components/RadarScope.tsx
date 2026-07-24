import type { TrackedSatelliteView } from "./Map2D";

interface RadarScopeProps {
  satellites: TrackedSatelliteView[];
  selectedSatelliteId: string | null;
  minElevationDeg: number;
  onSatelliteDoubleClick?: (satelliteId: string) => void;
}

const SIZE = 320;
const CENTER = SIZE / 2;
const RADIUS = SIZE / 2 - 30;
const COMPASS_LABELS = [
  { label: "N", x: CENTER, y: 20 },
  { label: "E", x: SIZE - 18, y: CENTER + 4 },
  { label: "S", x: CENTER, y: SIZE - 12 },
  { label: "W", x: 18, y: CENTER + 4 }
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function plotPoint(azimuthDeg: number, elevationDeg: number) {
  const azimuth = ((azimuthDeg - 90) * Math.PI) / 180;
  const distance = ((90 - clamp(elevationDeg, 0, 90)) / 90) * RADIUS;

  return {
    x: CENTER + Math.cos(azimuth) * distance,
    y: CENTER + Math.sin(azimuth) * distance
  };
}

export function RadarScope({
  satellites,
  selectedSatelliteId,
  minElevationDeg,
  onSatelliteDoubleClick
}: RadarScopeProps) {
  const horizonRadius = ((90 - clamp(minElevationDeg, 0, 90)) / 90) * RADIUS;

  return (
    <section className="panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label">Radar</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--text)]">Tracking scope</h2>
        </div>
        <span className="mono rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 text-xs text-[var(--muted)]">
          {satellites.length} target{satellites.length === 1 ? "" : "s"}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mt-4 h-[280px] w-full sm:h-[320px]"
        role="img"
        aria-label="Radar scope showing satellite azimuth and elevation"
      >
        <rect width={SIZE} height={SIZE} rx="10" fill="#0c0d10" stroke="rgba(255,255,255,0.07)" />
        <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="rgba(101,189,142,0.035)" stroke="rgba(101,189,142,0.32)" />
        {[30, 60, 90].map((elevation) => (
          <circle
            key={elevation}
            cx={CENTER}
            cy={CENTER}
            r={((90 - elevation) / 90) * RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
          />
        ))}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={horizonRadius}
          fill="none"
          stroke="rgba(224,164,88,0.55)"
          strokeDasharray="5 6"
        />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((bearing) => {
          const angle = ((bearing - 90) * Math.PI) / 180;
          const inner = bearing % 90 === 0 ? 12 : 24;
          return (
            <line
              key={bearing}
              x1={CENTER + Math.cos(angle) * inner}
              y1={CENTER + Math.sin(angle) * inner}
              x2={CENTER + Math.cos(angle) * RADIUS}
              y2={CENTER + Math.sin(angle) * RADIUS}
              stroke="rgba(255,255,255,0.07)"
            />
          );
        })}
        {COMPASS_LABELS.map(({ label, x, y }) => (
          <text key={label} x={x} y={y} textAnchor="middle" fill="#8f98a6" fontSize="12" fontWeight="700">
            {label}
          </text>
        ))}
        <text x={CENTER} y={CENTER - 5} textAnchor="middle" fill="#8a8e97" fontSize="10">
          Zenith
        </text>

        {satellites.map((satellite) => {
          const point = plotPoint(satellite.azimuthDeg, satellite.elevationDeg);
          const selected = satellite.id === selectedSatelliteId;
          const belowMask = satellite.elevationDeg < minElevationDeg;

          return (
            <g
              key={satellite.id}
              className="cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label={`Inspect ${satellite.name}`}
              opacity={belowMask ? 0.18 : 1}
              onClick={(event) => {
                event.preventDefault();
                onSatelliteDoubleClick?.(satellite.id);
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                onSatelliteDoubleClick?.(satellite.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSatelliteDoubleClick?.(satellite.id);
                }
              }}
            >
              <title>{`${satellite.name}: az ${satellite.azimuthDeg.toFixed(1)} deg, el ${satellite.elevationDeg.toFixed(1)} deg`}</title>
              <circle
                cx={point.x}
                cy={point.y}
                r={selected ? 8 : 6}
                fill={satellite.color}
                stroke="#05070a"
                strokeWidth="2"
              />
              {selected ? (
                <circle cx={point.x} cy={point.y} r="14" fill="none" stroke={satellite.color} strokeOpacity="0.72" strokeWidth="2" />
              ) : null}
              <text
                x={point.x + 11}
                y={point.y - 8}
                fill="#eef2f0"
                fontSize="11"
                fontWeight="700"
                paintOrder="stroke"
                stroke="#05070a"
                strokeWidth="3"
              >
                {satellite.name}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-3 grid gap-2">
        {satellites.slice(0, 4).map((satellite) => (
          <button
            key={satellite.id}
            type="button"
            className="radar-target-row"
            onClick={() => onSatelliteDoubleClick?.(satellite.id)}
            title="Inspect this satellite"
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: satellite.color }} />
              <span className="truncate">{satellite.name}</span>
            </span>
            <span className="mono shrink-0 text-xs text-[var(--muted)]">
              {satellite.azimuthDeg.toFixed(0)} deg / {satellite.elevationDeg.toFixed(0)} deg
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
