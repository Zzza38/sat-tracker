import { PassSample } from "@/shared/types";
import { elevationToColor, elevationToColorWithAlpha } from "@/shared/passes/elevation-color";

interface ElevationChartProps {
  samples: PassSample[];
  colorByElevation?: boolean;
  minElevationDeg?: number;
  satelliteColor?: string;
}

export function ElevationChart({
  samples,
  colorByElevation = false,
  minElevationDeg = 0,
  satelliteColor = "#6c8cff"
}: ElevationChartProps) {
  if (samples.length === 0) {
    return (
      <div className="grid h-[260px] place-items-center rounded-[10px] border border-[var(--line)] bg-[#0c0d10] text-sm text-[var(--muted)]">
        No elevation samples available.
      </div>
    );
  }

  const width = 640;
  const height = 260;
  const padding = { top: 38, right: 24, bottom: 44, left: 52 };
  const yMax = 90;
  const yTicks = [0, 30, 60, 90];
  const colorOptions = { minElevationDeg, maxElevationDeg: yMax };
  const start = new Date(samples[0]?.timestamp ?? Date.now()).getTime();
  const end = new Date(samples[samples.length - 1]?.timestamp ?? Date.now()).getTime();
  const formatTime = (timestamp: number) =>
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit"
    }).format(timestamp);

  const plotLeft = padding.left;
  const plotRight = width - padding.right;
  const plotTop = padding.top;
  const plotBottom = height - padding.bottom;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  const samplePoints = samples.map((sample) => {
    const x =
      plotLeft +
      ((new Date(sample.timestamp).getTime() - start) / Math.max(end - start, 1)) * plotWidth;
    const y = plotBottom - (sample.elevationDeg / yMax) * plotHeight;

    return { sample, x, y };
  });

  const points = samplePoints.map(({ x, y }) => `${x},${y}`);
  const linePoints = samplePoints.length === 1 ? [...points, ...points] : points;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[260px] w-full" role="img" aria-label="Pass elevation over time">
      <rect width={width} height={height} rx="10" fill="#0c0d10" stroke="rgba(255,255,255,0.07)" />
      <text x={padding.left} y="22" fill="#e9eaec" fontSize="13" fontWeight="600">
        Elevation during pass
      </text>
      <text x={width - padding.right} y="22" fill="#9a9ea7" fontSize="11" textAnchor="end">
        degrees above horizon
      </text>

      {yTicks.map((tick) => {
        const y = plotBottom - (tick / yMax) * plotHeight;
        return (
          <g key={tick}>
            <line x1={plotLeft} x2={plotRight} y1={y} y2={y} stroke="rgba(255,255,255,0.06)" />
            <text x={plotLeft - 10} y={y + 4} fill="#8a8e97" fontSize="10" textAnchor="end">
              {tick}°
            </text>
          </g>
        );
      })}

      <line x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} stroke="rgba(255,255,255,0.12)" />
      <line x1={plotLeft} x2={plotLeft} y1={plotTop} y2={plotBottom} stroke="rgba(255,255,255,0.12)" />

      {colorByElevation ? (
        <>
          {samplePoints.slice(1).map(({ sample, x, y }, index) => {
            const previous = samplePoints[index];
            const segmentElevation = (previous.sample.elevationDeg + sample.elevationDeg) / 2;

            return (
              <polygon
                key={`${previous.sample.timestamp}-${sample.timestamp}-fill`}
                fill={elevationToColorWithAlpha(segmentElevation, 0.18, colorOptions)}
                stroke="none"
                points={`${previous.x},${previous.y} ${x},${y} ${x},${plotBottom} ${previous.x},${plotBottom}`}
              />
            );
          })}
          {samplePoints.slice(1).map(({ sample, x, y }, index) => {
            const previous = samplePoints[index];
            const segmentElevation = (previous.sample.elevationDeg + sample.elevationDeg) / 2;
            const color = elevationToColor(segmentElevation, colorOptions);

            return (
              <line
                key={`${previous.sample.timestamp}-${sample.timestamp}-stroke`}
                x1={previous.x}
                y1={previous.y}
                x2={x}
                y2={y}
                stroke={color}
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            );
          })}
        </>
      ) : (
        <>
          <polyline
            fill={satelliteColor}
            fillOpacity="0.12"
            stroke="none"
            points={`${plotLeft},${plotBottom} ${linePoints.join(" ")} ${plotRight},${plotBottom}`}
          />
          <polyline fill="none" stroke={satelliteColor} strokeWidth="2.5" points={linePoints.join(" ")} />
        </>
      )}

      <text x={plotLeft} y={height - 16} fill="#9a9ea7" fontSize="10" textAnchor="start">
        AOS {formatTime(start)}
      </text>
      <text x={(plotLeft + plotRight) / 2} y={height - 16} fill="#8a8e97" fontSize="10" textAnchor="middle">
        Time
      </text>
      <text x={plotRight} y={height - 16} fill="#9a9ea7" fontSize="10" textAnchor="end">
        LOS {formatTime(end)}
      </text>
    </svg>
  );
}
