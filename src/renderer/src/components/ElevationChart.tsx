import { useState, type MouseEvent } from "react";
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
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

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
      minute: "2-digit",
      timeZoneName: "short"
    }).format(timestamp);
  const duration = Math.max(end - start, 1);
  const innerTicks = [0.25, 0.5, 0.75].map((f) => start + duration * f);

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

  const peak = samplePoints.reduce(
    (best, p) => (p.sample.elevationDeg > best.sample.elevationDeg ? p : best),
    samplePoints[0]
  );

  const handleMove = (event: MouseEvent<SVGRectElement>) => {
    const svg = event.currentTarget.ownerSVGElement!;
    const rect = svg.getBoundingClientRect();
    const xSvg = ((event.clientX - rect.left) / rect.width) * width;

    let low = 0;
    let high = samplePoints.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (samplePoints[mid].x < xSvg) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    if (
      low > 0 &&
      Math.abs(samplePoints[low - 1].x - xSvg) <= Math.abs(samplePoints[low].x - xSvg)
    ) {
      low -= 1;
    }
    setHoverIndex(low);
  };

  const hoverPoint = hoverIndex === null ? null : samplePoints[hoverIndex];
  const hoverOnRightHalf = hoverPoint !== null && hoverPoint.x > (plotLeft + plotRight) / 2;
  const readoutX = hoverPoint ? (hoverOnRightHalf ? hoverPoint.x - 10 : hoverPoint.x + 10) : 0;
  const readoutY = hoverPoint ? Math.max(hoverPoint.y - 10, plotTop + 14) : 0;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="img" aria-label="Pass elevation over time">
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
            <text x={plotLeft - 10} y={y + 4} fill="var(--faint)" fontSize="10" textAnchor="end">
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

      <circle cx={peak.x} cy={peak.y} r="4" fill="#e9eaec" stroke="#0c0d10" strokeWidth="1.5" />
      <text
        x={peak.x}
        y={Math.max(peak.y - 10, padding.top + 2)}
        fill="#e9eaec"
        fontSize="10"
        textAnchor="middle"
      >
        Peak {formatTime(new Date(peak.sample.timestamp).getTime())}
      </text>

      {innerTicks.map((t) => {
        const x = plotLeft + ((t - start) / duration) * plotWidth;
        return (
          <g key={t}>
            <line x1={x} x2={x} y1={plotBottom} y2={plotBottom + 5} stroke="rgba(255,255,255,0.25)" />
            <text x={x} y={height - 16} fill="var(--faint)" fontSize="10" textAnchor="middle">
              {formatTime(t)}
            </text>
          </g>
        );
      })}

      {hoverPoint ? (
        <g pointerEvents="none">
          <line
            x1={hoverPoint.x}
            x2={hoverPoint.x}
            y1={plotTop}
            y2={plotBottom}
            stroke="rgba(255,255,255,0.28)"
            strokeDasharray="3 3"
          />
          <circle
            cx={hoverPoint.x}
            cy={hoverPoint.y}
            r="4.5"
            fill="#0c0d10"
            stroke={
              colorByElevation
                ? elevationToColor(hoverPoint.sample.elevationDeg, colorOptions)
                : satelliteColor
            }
            strokeWidth="2"
          />
          <text
            x={readoutX}
            y={readoutY}
            textAnchor={hoverOnRightHalf ? "end" : "start"}
            fill="#eef2f0"
            fontSize="11"
            fontWeight="700"
            paintOrder="stroke"
            stroke="#0c0d10"
            strokeWidth="3"
          >
            {formatTime(new Date(hoverPoint.sample.timestamp).getTime())}
          </text>
          <text
            x={readoutX}
            y={readoutY + 14}
            textAnchor={hoverOnRightHalf ? "end" : "start"}
            fill="#eef2f0"
            fontSize="11"
            fontWeight="700"
            paintOrder="stroke"
            stroke="#0c0d10"
            strokeWidth="3"
          >
            el {hoverPoint.sample.elevationDeg.toFixed(1)}°
          </text>
          <text
            x={readoutX}
            y={readoutY + 28}
            textAnchor={hoverOnRightHalf ? "end" : "start"}
            fill="#eef2f0"
            fontSize="11"
            fontWeight="700"
            paintOrder="stroke"
            stroke="#0c0d10"
            strokeWidth="3"
          >
            az {hoverPoint.sample.azimuthDeg.toFixed(0)}°
          </text>
        </g>
      ) : null}

      <rect
        x={plotLeft}
        y={plotTop}
        width={plotWidth}
        height={plotHeight}
        fill="transparent"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      />

      <text x={plotLeft} y={height - 16} fill="#9a9ea7" fontSize="10" textAnchor="start">
        <title>Acquisition of signal (pass start)</title>
        Start {formatTime(start)}
      </text>
      <text x={plotRight} y={height - 16} fill="#9a9ea7" fontSize="10" textAnchor="end">
        <title>Loss of signal (pass end)</title>
        End {formatTime(end)}
      </text>
    </svg>
  );
}
