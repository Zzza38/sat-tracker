import {
  lowPassAlpha,
  quatAngleDeg,
  quatConjugate,
  quatMultiply,
  quatNormalize,
  quatSlerp,
  quaternionFromSample,
  shouldAcceptOrientationSample,
  viewFromQuaternion,
  type OrientationSource,
  type Quaternion
} from "./ar";
import { arDebugLog, arDebugSample, isArDebugEnabled } from "./arDebug";

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
 *    `webkitCompassHeading` — is used only to find north: it may lock a
 *    yaw offset once the IMU is still and mag is settled, then nudge a few
 *    degrees of gyro bias. It is never the displayed heading on its own.
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
/**
 * Disagreements larger than this, with a continuous gyro frame, are a bad
 * compass lock — not gyro drift. Field log 2026-08-14: compass sat ~90° off
 * with 20-40° accuracy; the old 2 s snap then flipped the view from 311° to
 * 24°. Ignore those fixes and let the gyro carry the heading.
 */
const ANCHOR_IGNORE_DEG = 25;
/** A single relative-sample jump this large is a gyro-frame re-zero. */
const FRAME_JUMP_DEG = 60;
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
/** Cap the slew dt so a multi-second event gap cannot take a 5° step. */
const MAX_SLEW_DELTA_S = 0.1;
/**
 * Magnetometer (webkitCompassHeading) is not a turn sensor. Heading changes
 * come from the IMU (gyro + accelerometer). Mag may only cancel a few degrees
 * of gyro bias while the IMU is actually still — never a turn the IMU did not
 * measure. Field log 2026-08-14: alpha sat at ~275° while mag sat ~90° off;
 * treating that as a heading change produced the crawl-then-flip.
 */
const STILL_RELATIVE_JUMP_DEG = 2;
/** Residual gyro bias we will still cancel from mag while the IMU is still. */
const STILL_MAX_MAG_CORRECTION_DEG = 8;
/** Mag heading moving this much more than the IMU in one sample is interference. */
const MAG_VS_IMU_SLACK_DEG = 0.75;
/** First north lock waits until mag agrees with itself this long while still. */
const NORTH_SETTLE_MS = 400;
const NORTH_AGREE_DEG = 8;
/** Compass fixes with worse reported uncertainty than this are discarded. */
const MAX_COMPASS_ACCURACY_DEG = 25;

const round1 = (value: number) => Math.round(value * 10) / 10;
/** Heading a quaternion points at, for the debug log only. */
const debugHeading = (quaternion: Quaternion) =>
  round1(viewFromQuaternion(quaternion).headingDeg);

/**
 * Complementary filter: the IMU is the source of truth for motion; the
 * magnetometer only helps find north. Displayed heading is always
 * `correction * relative`, where `relative` is gyro+accelerometer. Mag never
 * replaces that quaternion. It may set `correction` once after a brief still
 * settle (north lock) and afterwards only nudge residual gyro bias.
 */
export class CompassGyroFusion {
  private relative: Quaternion | null = null;
  private relativeAtMs = 0;
  private lastRelativeJumpDeg = 0;
  private speedDegPerSec = 0;
  private correction: Quaternion | null = null;
  private lastCorrectionAtMs: number | null = null;
  private lastAbsolute: Quaternion | null = null;
  private northCandidate: Quaternion | null = null;
  private northCandidateAtMs = 0;

  updateRelative(quaternion: Quaternion, timestampMs: number) {
    if (this.relative !== null) {
      const deltaSeconds = (timestampMs - this.relativeAtMs) / 1000;
      if (deltaSeconds > 0) {
        const jumpDeg = quatAngleDeg(this.relative, quaternion);
        this.lastRelativeJumpDeg = jumpDeg;
        if (deltaSeconds <= MAX_SPEED_SAMPLE_GAP_S) {
          const rawSpeed = jumpDeg / deltaSeconds;
          this.speedDegPerSec +=
            (rawSpeed - this.speedDegPerSec) * lowPassAlpha(SPEED_CUTOFF_HZ, deltaSeconds);
          // Impossible physical rate: the relative frame re-zeroed. Rebase
          // the correction so the fused heading stays put instead of jumping
          // with the sensor, and instead of snapping onto whatever the
          // compass currently claims.
          if (jumpDeg > FRAME_JUMP_DEG && this.correction !== null) {
            this.correction = quatNormalize(
              quatMultiply(
                this.correction,
                quatMultiply(this.relative, quatConjugate(quaternion))
              )
            );
            if (isArDebugEnabled()) {
              arDebugLog("anchor-rebase", {
                jumpDeg: round1(jumpDeg),
                relH: debugHeading(quaternion)
              });
            }
          }
        } else {
          // Dropped events: keep the motion gate closed until fresh still
          // samples arrive. Do not rebase — a large jump across a gap may be
          // a real turn whose in-between samples were lost.
          this.lastRelativeJumpDeg = jumpDeg;
          this.speedDegPerSec = Math.max(
            this.speedDegPerSec,
            jumpDeg / deltaSeconds,
            ANCHOR_MAX_SPEED_DEG_PER_SEC + 1
          );
        }
      }
    }
    this.relative = quaternion;
    this.relativeAtMs = timestampMs;
  }

  hasFreshRelative(timestampMs: number) {
    return this.relative !== null && timestampMs - this.relativeAtMs <= RELATIVE_FRESH_MS;
  }

  updateAbsolute(quaternion: Quaternion, timestampMs: number, accuracyDeg?: number) {
    if (this.relative === null || !this.hasFreshRelative(timestampMs)) {
      return;
    }
    if (
      accuracyDeg !== undefined &&
      (accuracyDeg < 0 || accuracyDeg > MAX_COMPASS_ACCURACY_DEG)
    ) {
      arDebugSample("anchor-reject-accuracy", 1000, { acc: accuracyDeg });
      return;
    }
    const magJumpDeg =
      this.lastAbsolute === null ? 0 : quatAngleDeg(this.lastAbsolute, quaternion);
    this.lastAbsolute = quaternion;
    const target = quatNormalize(quatMultiply(quaternion, quatConjugate(this.relative)));

    if (this.correction === null || this.lastCorrectionAtMs === null) {
      // North lock: mag may set the yaw offset only after the IMU is still
      // and mag has agreed with itself briefly. A single magnetometer sample
      // is not north.
      const imuMoving =
        this.speedDegPerSec > ANCHOR_MAX_SPEED_DEG_PER_SEC ||
        this.lastRelativeJumpDeg > STILL_RELATIVE_JUMP_DEG;
      if (imuMoving) {
        this.northCandidate = null;
        arDebugSample("anchor-wait-north", 500, { reason: "imu-moving" });
        return;
      }
      if (this.northCandidate === null) {
        this.northCandidate = target;
        this.northCandidateAtMs = timestampMs;
        return;
      }
      if (quatAngleDeg(this.northCandidate, target) > NORTH_AGREE_DEG) {
        this.northCandidate = target;
        this.northCandidateAtMs = timestampMs;
        arDebugSample("anchor-wait-north", 500, { reason: "mag-unsettled" });
        return;
      }
      if (timestampMs - this.northCandidateAtMs < NORTH_SETTLE_MS) {
        return;
      }
      this.correction = target;
      this.lastCorrectionAtMs = timestampMs;
      this.northCandidate = null;
      if (isArDebugEnabled()) {
        arDebugLog("anchor-init", {
          relH: debugHeading(this.relative),
          absH: debugHeading(quaternion),
          acc: accuracyDeg
        });
      }
      return;
    }

    // While the device is turning (pan, shake), the compass and gyro sample
    // different instants and their comparison is meaningless — hold the
    // current anchor and let the gyro carry the view alone.
    if (this.speedDegPerSec > ANCHOR_MAX_SPEED_DEG_PER_SEC) {
      this.lastCorrectionAtMs = timestampMs;
      arDebugSample("anchor-hold-motion", 1000, { speed: round1(this.speedDegPerSec) });
      return;
    }

    const elapsedMs = timestampMs - this.lastCorrectionAtMs;
    this.lastCorrectionAtMs = timestampMs;
    const deltaDeg = quatAngleDeg(this.correction, target);
    if (deltaDeg < 1e-4) {
      return;
    }

    // Magnetometer is not a gyroscope. If the IMU barely moved and mag wants
    // a heading change bigger than residual bias, that is interference — the
    // 2026-08-14 hold-still-then-flip, where alpha sat at 275° the whole time.
    if (
      this.lastRelativeJumpDeg < STILL_RELATIVE_JUMP_DEG &&
      deltaDeg > STILL_MAX_MAG_CORRECTION_DEG
    ) {
      arDebugSample("anchor-reject-imu-still", 250, {
        deltaDeg: round1(deltaDeg),
        imuJump: round1(this.lastRelativeJumpDeg),
        magJump: round1(magJumpDeg),
        relH: debugHeading(this.relative),
        absH: debugHeading(quaternion),
        acc: accuracyDeg
      });
      return;
    }

    if (magJumpDeg > this.lastRelativeJumpDeg + MAG_VS_IMU_SLACK_DEG) {
      arDebugSample("anchor-reject-mag-disturbance", 250, {
        magJump: round1(magJumpDeg),
        imuJump: round1(this.lastRelativeJumpDeg),
        acc: accuracyDeg
      });
      return;
    }

    // Continuous gyro frame + large compass disagreement = bad magnetometer
    // lock. Holding is what stops the slow crawl-then-flip.
    if (deltaDeg > ANCHOR_IGNORE_DEG) {
      arDebugSample("anchor-reject-disagreement", 250, {
        deltaDeg: round1(deltaDeg),
        relH: debugHeading(this.relative),
        absH: debugHeading(quaternion),
        acc: accuracyDeg,
        speed: round1(this.speedDegPerSec)
      });
      return;
    }

    const deltaSeconds = Math.min(MAX_SLEW_DELTA_S, Math.max(1e-3, elapsedMs / 1000));
    const lowPassStepDeg = deltaDeg * lowPassAlpha(CORRECTION_CUTOFF_HZ, deltaSeconds);
    const stepDeg = Math.min(lowPassStepDeg, CORRECTION_MAX_SLEW_DEG_PER_SEC * deltaSeconds);
    this.correction = quatSlerp(this.correction, target, stepDeg / deltaDeg);
    if (isArDebugEnabled()) {
      arDebugSample("anchor", 500, {
        deltaDeg: round1(deltaDeg),
        stepDeg: Math.round(stepDeg * 1000) / 1000,
        relH: debugHeading(this.relative),
        absH: debugHeading(quaternion),
        acc: accuracyDeg,
        speed: round1(this.speedDegPerSec)
      });
    }
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
    if (activeSource !== source) {
      arDebugLog("source-switch", { from: activeSource, to: source });
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
        arDebugLog("fused-sensor-error");
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
  const emitFusion = (timestampMs: number) => {
    const output = fusion.output(timestampMs);
    if (output) {
      accept(output.quaternion, output.anchored ? "absolute" : "relative");
    }
    // No magnetometer-only fallback: mag finds north, it is not a heading
    // stream. Without a fresh IMU sample there is nothing to display.
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

    if (isArDebugEnabled()) {
      arDebugSample(`raw-${eventSource}`, 250, {
        a: event.alpha === null ? null : round1(event.alpha),
        b: event.beta === null ? null : round1(event.beta),
        g: event.gamma === null ? null : round1(event.gamma),
        compass:
          compassEvent.webkitCompassHeading === undefined
            ? undefined
            : round1(compassEvent.webkitCompassHeading),
        acc: compassEvent.webkitCompassAccuracy,
        abs: event.absolute,
        screen: screenAngleDeg
      });
    }

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
    emitFusion(now);
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
