import { PassSample } from "@/shared/types";
import { elevationToColor } from "@/shared/passes/elevation-color";

interface SkyPlotProps {
  samples: PassSample[];
  minElevationDeg?: number;
  colorByElevation?: boolean;
  satelliteColor?: string;
}

export function SkyPlot({
  samples,
  minElevationDeg = 0,
  colorByElevation = false,
  satelliteColor = "#6c8cff"
}: SkyPlotProps) {
  const size = 320;
  const center = size / 2;
  const radius = size / 2 - 24;
  const colorOptions = { minElevationDeg, maxElevationDeg: 90 };

  const project = (azimuthDeg: number, elevationDeg: number) => {
    const azimuth = ((azimuthDeg - 90) * Math.PI) / 180;
    const distance = ((90 - elevationDeg) / 90) * radius;
    return {
      x: center + Math.cos(azimuth) * distance,
      y: center + Math.sin(azimuth) * distance
    };
  };

  const horizonRadius = ((90 - minElevationDeg) / 90) * radius;
  const samplePoints = samples.map((sample) => ({
    sample,
    point: project(sample.azimuthDeg, sample.elevationDeg)
  }));

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-[320px] w-full">
      <rect width={size} height={size} rx="10" fill="#0c0d10" stroke="rgba(255,255,255,0.07)" />
      {[0, 30, 60, 90].map((ring) => (
        <circle
          key={ring}
          cx={center}
          cy={center}
          r={((90 - ring) / 90) * radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
        />
      ))}
      <circle cx={center} cy={center} r={horizonRadius} fill="none" stroke="rgba(224,164,88,0.5)" strokeDasharray="5 5" />
      <line x1={center} y1={24} x2={center} y2={size - 24} stroke="rgba(255,255,255,0.07)" />
      <line x1={24} y1={center} x2={size - 24} y2={center} stroke="rgba(255,255,255,0.07)" />

      {colorByElevation ? (
        <>
          {samplePoints.slice(1).map(({ sample, point }, index) => {
            const previous = samplePoints[index];
            const segmentElevation = (previous.sample.elevationDeg + sample.elevationDeg) / 2;
            const color = elevationToColor(segmentElevation, colorOptions);

            return (
              <line
                key={`${previous.sample.timestamp}-${sample.timestamp}`}
                x1={previous.point.x}
                y1={previous.point.y}
                x2={point.x}
                y2={point.y}
                stroke={color}
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            );
          })}
          {samplePoints.map(({ sample, point }) => (
            <circle
              key={sample.timestamp}
              cx={point.x}
              cy={point.y}
              r="2.5"
              fill={elevationToColor(sample.elevationDeg, colorOptions)}
            />
          ))}
        </>
      ) : (
        <>
          <path
            d={samplePoints
              .map(({ point }, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
              .join(" ")}
            fill="none"
            stroke={satelliteColor}
            strokeWidth="2.5"
          />
          {samplePoints.map(({ sample, point }) => (
            <circle key={sample.timestamp} cx={point.x} cy={point.y} r="2.5" fill={satelliteColor} />
          ))}
        </>
      )}

      <text x={center} y={20} textAnchor="middle" fill="#6c7079" fontSize="12">
        N
      </text>
    </svg>
  );
}
