const DEG = Math.PI / 180;

/** Boresight angles are useless once the projection is behind the camera. */
const MIN_DEPTH = 1e-4;

/**
 * Field of view of the rear camera measured across the long edge of the frame
 * it hands us. Phone wide cameras land around 65-70 degrees; the AR settings
 * panel lets the user trim this per device.
 */
export const DEFAULT_CAMERA_FOV_DEG = 68;
export const MIN_CAMERA_FOV_DEG = 40;
export const MAX_CAMERA_FOV_DEG = 120;

export const MAX_COMPASS_TRIM_DEG = 30;

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Unit quaternion rotating device/screen-frame vectors into the world frame
 * (east/north/up). Both the W3C deviceorientation rotation and the Generic
 * Sensor API AbsoluteOrientationSensor quaternion use this convention.
 */
export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface ViewDirection {
  headingDeg: number;
  elevationDeg: number;
  /** Screen rotation around the boresight. 0 when the device is held upright. */
  rollDeg?: number;
}

export interface CameraBasis {
  /** Boresight, in east/north/up. */
  forward: Vector3;
  /** Screen +x, in east/north/up. */
  right: Vector3;
  /** Screen up, in east/north/up. */
  up: Vector3;
}

export interface FieldOfView {
  /** Pinhole focal length expressed in stage pixels. */
  focalPx: number;
  horizontalDeg: number;
  verticalDeg: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  /** Cosine of the angle between the target and the boresight. */
  depth: number;
  behind: boolean;
  visible: boolean;
}

export interface OrientationSample {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  /** iOS true-north heading, which replaces the drifting relative alpha. */
  compassHeading?: number;
  /** screen.orientation.angle, so landscape does not shear the overlay. */
  screenAngleDeg?: number;
}

/**
 * Where an orientation reading came from, best first. "fused" is the Generic
 * Sensor API's gyro+accelerometer+magnetometer fusion; "absolute" is a
 * compass-anchored deviceorientation event; "relative" is gyro-only alpha
 * with an arbitrary zero that drifts.
 */
export type OrientationSource = "fused" | "absolute" | "relative";

const SOURCE_RANK: Record<OrientationSource, number> = {
  fused: 3,
  absolute: 2,
  relative: 1
};

export function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

export function signedAngleDifference(targetDeg: number, originDeg: number) {
  return ((targetDeg - originDeg + 540) % 360) - 180;
}

function dot(a: Vector3, b: Vector3) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

export function quatMultiply(a: Quaternion, b: Quaternion): Quaternion {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w
  };
}

export function quatNormalize(q: Quaternion): Quaternion {
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (length < 1e-12) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}

export function quatFromAxisAngle(axis: Vector3, angleRad: number): Quaternion {
  const half = angleRad / 2;
  const s = Math.sin(half);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) };
}

function rotateVector(q: Quaternion, v: Vector3): Vector3 {
  // v' = v + 2w(q⃗ × v) + 2 q⃗ × (q⃗ × v)
  const qv: Vector3 = { x: q.x, y: q.y, z: q.z };
  const uv = cross(qv, v);
  const uuv = cross(qv, uv);
  return {
    x: v.x + 2 * (q.w * uv.x + uuv.x),
    y: v.y + 2 * (q.w * uv.y + uuv.y),
    z: v.z + 2 * (q.w * uv.z + uuv.z)
  };
}

/** Smallest rotation between two orientations, in degrees. */
export function quatAngleDeg(a: Quaternion, b: Quaternion) {
  const d = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return (2 * Math.acos(d)) / DEG;
}

/** Shortest-path spherical interpolation. */
export function quatSlerp(a: Quaternion, b: Quaternion, t: number): Quaternion {
  const amount = Math.max(0, Math.min(1, t));
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  let cosHalf = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cosHalf < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    cosHalf = -cosHalf;
  }

  if (cosHalf > 0.9995) {
    // Nearly parallel: nlerp avoids the divide-by-sin blowup.
    return quatNormalize({
      x: a.x + (bx - a.x) * amount,
      y: a.y + (by - a.y) * amount,
      z: a.z + (bz - a.z) * amount,
      w: a.w + (bw - a.w) * amount
    });
  }

  const halfAngle = Math.acos(cosHalf);
  const sinHalf = Math.sin(halfAngle);
  const ratioA = Math.sin((1 - amount) * halfAngle) / sinHalf;
  const ratioB = Math.sin(amount * halfAngle) / sinHalf;
  return {
    x: a.x * ratioA + bx * ratioB,
    y: a.y * ratioA + by * ratioB,
    z: a.z * ratioA + bz * ratioB,
    w: a.w * ratioA + bw * ratioB
  };
}

/**
 * Full device rotation for a W3C orientation event, as a quaternion:
 * R = Rz(alpha) Rx(beta) Ry(gamma), then the screen-orientation twist so the
 * returned rotation maps *screen* axes (not device axes) into east/north/up.
 */
export function quaternionFromSample(sample: OrientationSample): Quaternion | null {
  const { alpha, beta, gamma, compassHeading, screenAngleDeg = 0 } = sample;
  if (beta === null || gamma === null) {
    return null;
  }
  if (alpha === null && compassHeading === undefined) {
    return null;
  }

  // Relative alpha drifts; when iOS gives us a true-north heading, feed that
  // through the same rotation instead of patching the heading afterwards.
  const alphaDeg = compassHeading === undefined
    ? (alpha ?? 0)
    : normalizeDegrees(360 - compassHeading);

  const halfA = (alphaDeg * DEG) / 2;
  const halfB = (beta * DEG) / 2;
  const halfG = (gamma * DEG) / 2;
  const qz: Quaternion = { x: 0, y: 0, z: Math.sin(halfA), w: Math.cos(halfA) };
  const qx: Quaternion = { x: Math.sin(halfB), y: 0, z: 0, w: Math.cos(halfB) };
  const qy: Quaternion = { x: 0, y: Math.sin(halfG), z: 0, w: Math.cos(halfG) };
  const device = quatMultiply(quatMultiply(qz, qx), qy);

  if (screenAngleDeg === 0) {
    return device;
  }
  // Post-multiplied twist about the device z axis rotates device x/y into
  // screen-right/up while leaving the boresight untouched.
  const screenTwist = quatFromAxisAngle({ x: 0, y: 0, z: 1 }, -screenAngleDeg * DEG);
  return quatMultiply(device, screenTwist);
}

/** World-space camera axes for a screen-frame orientation quaternion. */
export function basisFromQuaternion(q: Quaternion): CameraBasis {
  const right = rotateVector(q, { x: 1, y: 0, z: 0 });
  const up = rotateVector(q, { x: 0, y: 1, z: 0 });
  const outward = rotateVector(q, { x: 0, y: 0, z: 1 });
  // The rear camera looks along the screen's inward normal.
  return {
    right,
    up,
    forward: { x: -outward.x, y: -outward.y, z: -outward.z }
  };
}

/** Heading/elevation/roll readout for a screen-frame orientation quaternion. */
export function viewFromQuaternion(q: Quaternion): ViewDirection {
  const basis = basisFromQuaternion(q);
  const forward = basis.forward;
  const headingDeg = normalizeDegrees(Math.atan2(forward.x, forward.y) / DEG);
  const elevationDeg = Math.asin(Math.max(-1, Math.min(1, forward.z))) / DEG;

  // Roll measured against the unrolled basis for the same boresight, so
  // viewBasis() reconstructs exactly the axes the device is holding.
  const heading = headingDeg * DEG;
  const level: Vector3 = { x: Math.cos(heading), y: -Math.sin(heading), z: 0 };
  const vertical = cross(level, forward);
  const rollDeg = normalizeDegrees(
    Math.atan2(dot(basis.right, vertical), dot(basis.right, level)) / DEG
  );

  return { headingDeg, elevationDeg, rollDeg };
}

/** Inverse of viewFromQuaternion, for manual aiming without a sensor. */
export function quaternionFromView(view: ViewDirection): Quaternion {
  const basis = viewBasis(view);
  // Columns of the screen-to-world rotation are the screen axes in world
  // space; the screen's outward normal is the reverse of the boresight.
  const m00 = basis.right.x;
  const m10 = basis.right.y;
  const m20 = basis.right.z;
  const m01 = basis.up.x;
  const m11 = basis.up.y;
  const m21 = basis.up.z;
  const m02 = -basis.forward.x;
  const m12 = -basis.forward.y;
  const m22 = -basis.forward.z;

  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return quatNormalize({
      w: s / 4,
      x: (m21 - m12) / s,
      y: (m02 - m20) / s,
      z: (m10 - m01) / s
    });
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return quatNormalize({
      w: (m21 - m12) / s,
      x: s / 4,
      y: (m01 + m10) / s,
      z: (m02 + m20) / s
    });
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return quatNormalize({
      w: (m02 - m20) / s,
      x: (m01 + m10) / s,
      y: s / 4,
      z: (m12 + m21) / s
    });
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return quatNormalize({
    w: (m10 - m01) / s,
    x: (m02 + m20) / s,
    y: (m12 + m21) / s,
    z: s / 4
  });
}

/**
 * Compass bias correction. Positive trim swings the reported heading
 * clockwise (east), which compensates a compass that reads low.
 */
export function applyHeadingTrim(q: Quaternion, trimDeg: number): Quaternion {
  if (trimDeg === 0) {
    return q;
  }
  // A counter-clockwise world-z rotation lowers the heading, so negate.
  const twist = quatFromAxisAngle({ x: 0, y: 0, z: 1 }, -trimDeg * DEG);
  return quatMultiply(twist, q);
}

export interface OrientationFilterOptions {
  /** Cutoff while stationary; lower = steadier but slower to settle. */
  minCutoffHz?: number;
  /** Cutoff gain per deg/s of motion; higher = tighter tracking while panning. */
  speedCoefficient?: number;
  /** Cutoff of the internal angular-speed estimate. */
  derivativeCutoffHz?: number;
}

const FILTER_DEFAULTS: Required<OrientationFilterOptions> = {
  minCutoffHz: 1,
  speedCoefficient: 0.06,
  derivativeCutoffHz: 1.5
};

function lowPassAlpha(cutoffHz: number, deltaSeconds: number) {
  return 1 - Math.exp(-2 * Math.PI * cutoffHz * deltaSeconds);
}

/**
 * One Euro filter over orientation quaternions. The cutoff frequency scales
 * with angular speed, so a still device gets heavy smoothing (no jitter) while
 * a panning device is passed through almost raw (no perceptible lag). This is
 * what replaced the fixed-time-constant filter that read as the overlay
 * trailing the camera by a beat.
 */
export class OrientationFilter {
  private readonly options: Required<OrientationFilterOptions>;
  private state: Quaternion | null = null;
  private lastRaw: Quaternion | null = null;
  private lastTimestampMs: number | null = null;
  private speedDegPerSec = 0;

  constructor(options: OrientationFilterOptions = {}) {
    this.options = { ...FILTER_DEFAULTS, ...options };
  }

  reset() {
    this.state = null;
    this.lastRaw = null;
    this.lastTimestampMs = null;
    this.speedDegPerSec = 0;
  }

  current(): Quaternion | null {
    return this.state;
  }

  update(target: Quaternion, timestampMs: number): Quaternion {
    if (this.state === null || this.lastRaw === null || this.lastTimestampMs === null) {
      this.state = target;
      this.lastRaw = target;
      this.lastTimestampMs = timestampMs;
      this.speedDegPerSec = 0;
      return target;
    }

    const deltaSeconds = Math.min(0.25, Math.max(1e-3, (timestampMs - this.lastTimestampMs) / 1000));
    const rawSpeed = quatAngleDeg(this.lastRaw, target) / deltaSeconds;
    const speedAlpha = lowPassAlpha(this.options.derivativeCutoffHz, deltaSeconds);
    this.speedDegPerSec += (rawSpeed - this.speedDegPerSec) * speedAlpha;

    const cutoff = this.options.minCutoffHz + this.options.speedCoefficient * this.speedDegPerSec;
    const alpha = lowPassAlpha(cutoff, deltaSeconds);
    this.state = quatSlerp(this.state, target, alpha);
    this.lastRaw = target;
    this.lastTimestampMs = timestampMs;
    return this.state;
  }
}

/**
 * Whether a new orientation reading should replace the current stream. A
 * better source always wins; a worse one only takes over once the better
 * stream has gone quiet, so gyro-relative alpha cannot yank the view away
 * from a live compass fix.
 */
export function shouldAcceptOrientationSample(
  activeSource: OrientationSource | null,
  incomingSource: OrientationSource,
  millisecondsSinceActive = 0,
  staleAfterMs = 1500
) {
  if (activeSource === null) {
    return true;
  }
  if (SOURCE_RANK[incomingSource] >= SOURCE_RANK[activeSource]) {
    return true;
  }
  return millisecondsSinceActive > staleAfterMs;
}

export function dishFaceElevation(targetElevationDeg: number, offsetDeg: number) {
  return Math.max(-90, Math.min(90, targetElevationDeg - Math.max(0, offsetDeg)));
}

/** Unit vector for a look angle, in east/north/up. */
export function directionVector(azimuthDeg: number, elevationDeg: number): Vector3 {
  const azimuth = azimuthDeg * DEG;
  const elevation = elevationDeg * DEG;
  const horizontal = Math.cos(elevation);
  return {
    x: horizontal * Math.sin(azimuth),
    y: horizontal * Math.cos(azimuth),
    z: Math.sin(elevation)
  };
}

export interface LookAngles {
  azimuthDeg: number;
  elevationDeg: number;
  rangeKm?: number;
}

/**
 * Position between two propagated look angles, interpolated on the unit
 * sphere. Propagation runs at 1 Hz on the shared ticker; this is what lets
 * the marker glide at display rate instead of stepping once a second.
 */
export function interpolateLookAngles(a: LookAngles, b: LookAngles, t: number): LookAngles {
  const amount = Math.max(0, Math.min(2, t));
  const va = directionVector(a.azimuthDeg, a.elevationDeg);
  const vb = directionVector(b.azimuthDeg, b.elevationDeg);
  const mix: Vector3 = {
    x: va.x + (vb.x - va.x) * amount,
    y: va.y + (vb.y - va.y) * amount,
    z: va.z + (vb.z - va.z) * amount
  };
  const length = Math.hypot(mix.x, mix.y, mix.z);
  if (length < 1e-9) {
    return { azimuthDeg: a.azimuthDeg, elevationDeg: a.elevationDeg, rangeKm: a.rangeKm };
  }
  const azimuthDeg = normalizeDegrees(Math.atan2(mix.x / length, mix.y / length) / DEG);
  const elevationDeg = Math.asin(Math.max(-1, Math.min(1, mix.z / length))) / DEG;
  const rangeKm =
    a.rangeKm !== undefined && b.rangeKm !== undefined
      ? a.rangeKm + (b.rangeKm - a.rangeKm) * amount
      : a.rangeKm;
  return { azimuthDeg, elevationDeg, rangeKm };
}

/**
 * Camera axes for a view direction. Deriving right/up from the boresight keeps
 * the two screen axes orthonormal, which is what makes the overlay hold still
 * when the phone is tilted or rolled rather than only panned.
 */
export function viewBasis(view: ViewDirection): CameraBasis {
  const forward = directionVector(view.headingDeg, view.elevationDeg);
  const heading = view.headingDeg * DEG;
  // Horizontal axis to the right of the boresight, independent of pitch.
  const level: Vector3 = { x: Math.cos(heading), y: -Math.sin(heading), z: 0 };
  const vertical = cross(level, forward);

  const roll = (view.rollDeg ?? 0) * DEG;
  const cosRoll = Math.cos(roll);
  const sinRoll = Math.sin(roll);

  return {
    forward,
    right: {
      x: level.x * cosRoll + vertical.x * sinRoll,
      y: level.y * cosRoll + vertical.y * sinRoll,
      z: level.z * cosRoll + vertical.z * sinRoll
    },
    up: {
      x: vertical.x * cosRoll - level.x * sinRoll,
      y: vertical.y * cosRoll - level.y * sinRoll,
      z: vertical.z * cosRoll - level.z * sinRoll
    }
  };
}

/**
 * Effective field of view of the stage, derived from the frame the camera is
 * actually delivering.
 *
 * `.ar-camera` uses `object-fit: cover`, so the frame is scaled until it covers
 * both stage axes and the overflow is cropped away. Both stage axes therefore
 * share one focal length, and the horizontal and vertical FOV fall out of the
 * stage aspect ratio instead of being guessed independently.
 */
export function stageFieldOfView(
  stageWidth: number,
  stageHeight: number,
  frameWidth = 0,
  frameHeight = 0,
  sourceFovDeg = DEFAULT_CAMERA_FOV_DEG
): FieldOfView {
  const width = Math.max(1, stageWidth);
  const height = Math.max(1, stageHeight);
  const fov = Math.max(MIN_CAMERA_FOV_DEG, Math.min(MAX_CAMERA_FOV_DEG, sourceFovDeg));

  const hasFrame = frameWidth > 0 && frameHeight > 0;
  // Without a frame (camera off, or metadata not in yet) treat the stage itself
  // as the frame so the overlay still degrades to something isotropic.
  const longEdge = hasFrame ? Math.max(frameWidth, frameHeight) : Math.max(width, height);
  const coverScale = hasFrame
    ? Math.max(width / frameWidth, height / frameHeight)
    : 1;
  const focalPx = (longEdge / 2 / Math.tan((fov * DEG) / 2)) * coverScale;

  return {
    focalPx,
    horizontalDeg: (2 * Math.atan(width / 2 / focalPx)) / DEG,
    verticalDeg: (2 * Math.atan(height / 2 / focalPx)) / DEG
  };
}

/** Heading/elevation/roll for a raw W3C orientation event. */
export function directionFromOrientation(sample: OrientationSample): ViewDirection | null {
  const q = quaternionFromSample(sample);
  return q === null ? null : viewFromQuaternion(q);
}

/**
 * Pinhole projection of a world direction onto the stage, for a camera basis
 * that has already been computed. A camera image is gnomonic, not linear in
 * angle, so off-axis targets need the tangent rather than a straight
 * degrees-to-pixels ratio.
 */
export function projectDirection(
  target: Vector3,
  basis: CameraBasis,
  width: number,
  height: number,
  fov: FieldOfView
): ProjectedPoint {
  const depth = dot(target, basis.forward);

  if (depth <= MIN_DEPTH) {
    return { x: width / 2, y: height / 2, depth, behind: true, visible: false };
  }

  const x = width / 2 + (fov.focalPx * dot(target, basis.right)) / depth;
  const y = height / 2 - (fov.focalPx * dot(target, basis.up)) / depth;

  return {
    x,
    y,
    depth,
    behind: false,
    visible: x >= 0 && x <= width && y >= 0 && y <= height
  };
}

/** Pinhole projection of a look angle onto the stage. */
export function projectLookAngle(
  azimuthDeg: number,
  elevationDeg: number,
  view: ViewDirection,
  width: number,
  height: number,
  fov: FieldOfView = stageFieldOfView(width, height)
): ProjectedPoint {
  return projectDirection(
    directionVector(azimuthDeg, elevationDeg),
    viewBasis(view),
    width,
    height,
    fov
  );
}

/** Angular separation between the boresight and a look angle, in degrees. */
export function offAxisAngleDeg(view: ViewDirection, azimuthDeg: number, elevationDeg: number) {
  const forward = directionVector(view.headingDeg, view.elevationDeg);
  const target = directionVector(azimuthDeg, elevationDeg);
  return Math.acos(Math.max(-1, Math.min(1, dot(forward, target)))) / DEG;
}

/**
 * Next upcoming look window: the first pass whose acquisition (AOS) is still
 * in the future. Passes already in progress (AOS past, LOS still ahead) are
 * skipped so reminders and the AR readout do not target a past start time.
 */
export function selectNextLookPass<T extends { aos: string }>(
  passes: readonly T[],
  now: Date | string = new Date()
): T | null {
  const nowIso = typeof now === "string" ? now : now.toISOString();
  return passes.find((pass) => pass.aos >= nowIso) ?? null;
}
