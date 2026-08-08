import {
  lowPassAlpha,
  quatAngleDeg,
  quatConjugate,
  quatMultiply,
  quatNormalize,
  quatSlerp,
  quaternionFromSample,
  shouldAcceptOrientationSample,
  type OrientationSource,
  type Quaternion
} from "./ar";

/**
 * Single stream of world-frame orientation quaternions, picking the best
 * source the device offers:
 *
 * 1. AbsoluteOrientationSensor (Generic Sensor API) — platform gyro +
 *    accelerometer + magnetometer fusion, absolute and drift-free.
 * 2. Compass-anchored gyro fusion built here from the W3C orientation events:
 *    the relative `deviceorientation` stream supplies all high-frequency
 *    motion (smooth, but its heading zero is arbitrary and drifts), while the
 *    compass stream — `deviceorientationabsolute`, or iOS
 *    `webkitCompassHeading` — is applied only as a slow, slew-limited anchor.
 *    Raw magnetometer headings routinely spike 20-40° indoors; fed to the
 *    display directly they made the whole overlay thrash around, so they are
 *    never allowed to move the view quickly.
 * 3. The relative stream alone, when no compass source ever reports.
 */

export type OrientationSampleHandler = (
  quaternion: Quaternion,
  source: OrientationSource
) => void;

interface DeviceOrientationWithCompass extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
  /** iOS heading uncertainty in degrees; negative means the fix is invalid. */
  webkitCompassAccuracy?: number;
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

/** How quickly the compass anchor may steer the gyro frame, at most. */
const CORRECTION_MAX_SLEW_DEG_PER_SEC = 5;
/** Low-pass cutoff of the anchor for small persistent offsets. */
const CORRECTION_CUTOFF_HZ = 0.2;
/** A disagreement this large is a frame reset, not drift; snap after a while. */
const CORRECTION_SNAP_DEG = 45;
const CORRECTION_SNAP_AFTER_MS = 2000;
/** Without a recent relative sample the fusion has no fast path to anchor. */
const RELATIVE_FRESH_MS = 800;
/**
 * Magnetometer fixes taken while the device is turning are unreliable: the
 * compass sample and the gyro pose it is compared against are not taken at the
 * same instant, so even a perfect compass looks tens of degrees off mid-pan.
 * This is also what makes the native iOS Compass app shake-proof — while the
 * device moves, only the gyro is consulted. Anchor only when quasi-static.
 */
const ANCHOR_MAX_SPEED_DEG_PER_SEC = 15;
/** Low-pass for the angular-speed estimate driving the motion gate. */
const SPEED_CUTOFF_HZ = 1.5;
const MAX_SPEED_SAMPLE_GAP_S = 0.5;
/** Compass fixes with worse reported uncertainty than this are discarded. */
const MAX_COMPASS_ACCURACY_DEG = 50;

/**
 * Complementary filter joining the two W3C orientation streams: gyro-relative
 * orientation for responsiveness, compass for absolute reference. The
 * correction rotating the relative frame onto the compass frame is adapted
 * slowly and with a hard slew limit, so a 35-degree magnetometer spike moves
 * the view by a degree or two at most, while genuine gyro drift (well under a
 * degree per second) is still corrected promptly. Compass fixes are ignored
 * entirely while the device is turning and when iOS flags them as inaccurate
 * — the same policy that keeps the native Compass app rock-solid under
 * shaking.
 */
export class CompassGyroFusion {
  private relative: Quaternion | null = null;
  private relativeAtMs = 0;
  private speedDegPerSec = 0;
  private correction: Quaternion | null = null;
  private lastCorrectionAtMs: number | null = null;
  private largeDeltaSinceMs: number | null = null;

  updateRelative(quaternion: Quaternion, timestampMs: number) {
    if (this.relative !== null) {
      const deltaSeconds = (timestampMs - this.relativeAtMs) / 1000;
      if (deltaSeconds > 0 && deltaSeconds <= MAX_SPEED_SAMPLE_GAP_S) {
        const rawSpeed = quatAngleDeg(this.relative, quaternion) / deltaSeconds;
        this.speedDegPerSec +=
          (rawSpeed - this.speedDegPerSec) * lowPassAlpha(SPEED_CUTOFF_HZ, deltaSeconds);
      } else {
        this.speedDegPerSec = 0;
      }
    }
    this.relative = quaternion;
    this.relativeAtMs = timestampMs;
  }

  hasFreshRelative(timestampMs: number) {
    return this.relative !== null && timestampMs - this.relativeAtMs <= RELATIVE_FRESH_MS;
  }

  updateAbsolute(quaternion: Quaternion, timestampMs: number, accuracyDeg?: number) {
    if (this.relative === null) {
      return;
    }
    if (
      accuracyDeg !== undefined &&
      (accuracyDeg < 0 || accuracyDeg > MAX_COMPASS_ACCURACY_DEG)
    ) {
      return;
    }
    const target = quatNormalize(quatMultiply(quaternion, quatConjugate(this.relative)));

    if (this.correction === null || this.lastCorrectionAtMs === null) {
      this.correction = target;
      this.lastCorrectionAtMs = timestampMs;
      return;
    }

    // While the device is turning (pan, shake), the compass and gyro sample
    // different instants and their comparison is meaningless — hold the
    // current anchor and let the gyro carry the view alone.
    if (this.speedDegPerSec > ANCHOR_MAX_SPEED_DEG_PER_SEC) {
      this.lastCorrectionAtMs = timestampMs;
      this.largeDeltaSinceMs = null;
      return;
    }

    const deltaSeconds = Math.min(1, Math.max(1e-3, (timestampMs - this.lastCorrectionAtMs) / 1000));
    this.lastCorrectionAtMs = timestampMs;
    const deltaDeg = quatAngleDeg(this.correction, target);
    if (deltaDeg < 1e-4) {
      this.largeDeltaSinceMs = null;
      return;
    }

    // A huge, persistent disagreement means the relative frame itself jumped
    // (tab resume, sensor restart). Waiting out the slew limit would take ages,
    // so snap once the disagreement has clearly settled in.
    if (deltaDeg > CORRECTION_SNAP_DEG) {
      if (this.largeDeltaSinceMs === null) {
        this.largeDeltaSinceMs = timestampMs;
      } else if (timestampMs - this.largeDeltaSinceMs > CORRECTION_SNAP_AFTER_MS) {
        this.correction = target;
        this.largeDeltaSinceMs = null;
        return;
      }
    } else {
      this.largeDeltaSinceMs = null;
    }

    const lowPassStepDeg = deltaDeg * lowPassAlpha(CORRECTION_CUTOFF_HZ, deltaSeconds);
    const stepDeg = Math.min(lowPassStepDeg, CORRECTION_MAX_SLEW_DEG_PER_SEC * deltaSeconds);
    this.correction = quatSlerp(this.correction, target, stepDeg / deltaDeg);
  }

  /** Best current orientation, or null when no usable relative sample exists. */
  output(timestampMs: number): { quaternion: Quaternion; anchored: boolean } | null {
    if (this.relative === null || !this.hasFreshRelative(timestampMs)) {
      return null;
    }
    if (this.correction === null) {
      return { quaternion: this.relative, anchored: false };
    }
    return {
      quaternion: quatNormalize(quatMultiply(this.correction, this.relative)),
      anchored: true
    };
  }
}

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
  const fusion = new CompassGyroFusion();

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

  // --- Source 1: platform fused absolute orientation sensor ----------------
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

  // --- Source 2 & 3: W3C orientation events through the compass-gyro fusion -
  const emitFusion = (timestampMs: number, fallback?: Quaternion) => {
    const output = fusion.output(timestampMs);
    if (output) {
      accept(output.quaternion, output.anchored ? "absolute" : "relative");
    } else if (fallback) {
      // Compass-only device: no smooth stream to anchor, use it directly and
      // let the display-side filter absorb what noise it can.
      accept(fallback, "absolute");
    }
  };

  const handleOrientation = (
    event: DeviceOrientationEvent,
    eventSource: "absolute" | "relative"
  ) => {
    const compassEvent = event as DeviceOrientationWithCompass;
    const now = performance.now();
    const screenAngleDeg = readScreenAngle();
    const hasCompassHeading = compassEvent.webkitCompassHeading !== undefined;
    const isAbsolute = eventSource === "absolute" || event.absolute || hasCompassHeading;

    if (!isAbsolute) {
      const relative = quaternionFromSample({
        alpha: event.alpha,
        beta: event.beta,
        gamma: event.gamma,
        screenAngleDeg
      });
      if (relative) {
        fusion.updateRelative(relative, now);
        emitFusion(now);
      }
      return;
    }

    const absolute = quaternionFromSample({
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma,
      compassHeading: compassEvent.webkitCompassHeading,
      screenAngleDeg
    });
    if (!absolute) {
      return;
    }

    // iOS packs both signals into one event: gyro-relative alpha plus the
    // compass heading. Use the relative part as the fast path there too.
    if (hasCompassHeading && event.alpha !== null) {
      const relative = quaternionFromSample({
        alpha: event.alpha,
        beta: event.beta,
        gamma: event.gamma,
        screenAngleDeg
      });
      if (relative) {
        fusion.updateRelative(relative, now);
      }
    }

    fusion.updateAbsolute(
      absolute,
      now,
      hasCompassHeading ? compassEvent.webkitCompassAccuracy : undefined
    );
    emitFusion(now, absolute);
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
