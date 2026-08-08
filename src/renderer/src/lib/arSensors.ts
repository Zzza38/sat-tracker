import {
  quaternionFromSample,
  shouldAcceptOrientationSample,
  type OrientationSource,
  type Quaternion
} from "./ar";

/**
 * Single stream of world-frame orientation quaternions, picking the best
 * source the device offers:
 *
 * 1. AbsoluteOrientationSensor (Generic Sensor API) — gyro + accelerometer +
 *    magnetometer fusion, absolute and drift-free, delivered at display rate.
 * 2. `deviceorientationabsolute` / iOS `webkitCompassHeading` — compass-anchored.
 * 3. `deviceorientation` — gyro-relative alpha, drifts; last resort only.
 *
 * All sources stay attached: if the good one goes quiet (magnetometer lost,
 * sensor error) a lesser one takes over after a short staleness window.
 */

export type OrientationSampleHandler = (
  quaternion: Quaternion,
  source: OrientationSource
) => void;

interface DeviceOrientationWithCompass extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

interface GenericOrientationSensor extends EventTarget {
  start(): void;
  stop(): void;
  quaternion?: readonly number[] | Float32Array | null;
}

type GenericOrientationSensorConstructor = new (options?: {
  frequency?: number;
  referenceFrame?: "device" | "screen";
}) => GenericOrientationSensor;

const FUSED_SENSOR_FREQUENCY_HZ = 60;

/**
 * Landscape rotates the screen axes away from the device axes, so the overlay
 * needs the current angle to stay square with the camera frame.
 */
export function readScreenAngle() {
  const angle = window.screen?.orientation?.angle;
  if (typeof angle === "number") {
    return angle;
  }
  const legacy = (window as { orientation?: number }).orientation;
  return typeof legacy === "number" ? ((legacy % 360) + 360) % 360 : 0;
}

export function startOrientationStream(onSample: OrientationSampleHandler): () => void {
  let activeSource: OrientationSource | null = null;
  let lastActiveAt = 0;
  let stopped = false;

  const accept = (quaternion: Quaternion, source: OrientationSource) => {
    if (stopped) {
      return;
    }
    const now = performance.now();
    if (!shouldAcceptOrientationSample(activeSource, source, now - lastActiveAt)) {
      return;
    }
    activeSource = source;
    lastActiveAt = now;
    onSample(quaternion, source);
  };

  // --- Source 1: fused absolute orientation sensor -------------------------
  let fusedSensor: GenericOrientationSensor | null = null;
  const SensorConstructor = (
    window as { AbsoluteOrientationSensor?: GenericOrientationSensorConstructor }
  ).AbsoluteOrientationSensor;

  if (SensorConstructor) {
    try {
      // referenceFrame "screen" folds the screen-orientation twist in for us.
      const sensor = new SensorConstructor({
        frequency: FUSED_SENSOR_FREQUENCY_HZ,
        referenceFrame: "screen"
      });
      sensor.addEventListener("reading", () => {
        const q = sensor.quaternion;
        if (q && q.length === 4) {
          accept({ x: q[0], y: q[1], z: q[2], w: q[3] }, "fused");
        }
      });
      // No hardware / permission-policy denial surfaces here; the event
      // listeners below simply keep serving as the fallback.
      sensor.addEventListener("error", () => {
        try {
          sensor.stop();
        } catch {
          // Already stopped.
        }
        if (fusedSensor === sensor) {
          fusedSensor = null;
        }
      });
      sensor.start();
      fusedSensor = sensor;
    } catch {
      fusedSensor = null;
    }
  }

  // --- Sources 2 & 3: W3C orientation events -------------------------------
  const handleOrientation = (
    event: DeviceOrientationEvent,
    eventSource: "absolute" | "relative"
  ) => {
    const compassEvent = event as DeviceOrientationWithCompass;
    const source: OrientationSource =
      eventSource === "absolute" ||
      event.absolute ||
      compassEvent.webkitCompassHeading !== undefined
        ? "absolute"
        : "relative";

    const quaternion = quaternionFromSample({
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma,
      compassHeading: compassEvent.webkitCompassHeading,
      screenAngleDeg: readScreenAngle()
    });
    if (quaternion) {
      accept(quaternion, source);
    }
  };

  const handleAbsolute = (event: Event) =>
    handleOrientation(event as DeviceOrientationEvent, "absolute");
  const handleRelative = (event: DeviceOrientationEvent) =>
    handleOrientation(event, "relative");

  window.addEventListener("deviceorientationabsolute", handleAbsolute, true);
  window.addEventListener("deviceorientation", handleRelative, true);

  return () => {
    stopped = true;
    window.removeEventListener("deviceorientationabsolute", handleAbsolute, true);
    window.removeEventListener("deviceorientation", handleRelative, true);
    if (fusedSensor) {
      try {
        fusedSensor.stop();
      } catch {
        // Already stopped.
      }
      fusedSensor = null;
    }
  };
}
