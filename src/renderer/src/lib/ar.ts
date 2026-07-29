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

export interface Vector3 {
  x: number;
  y: number;
  z: number;
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

export type OrientationSource = "absolute" | "relative";

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

export function interpolateViewDirection(
  current: ViewDirection,
  target: ViewDirection,
  amount: number
): ViewDirection {
  const factor = Math.max(0, Math.min(1, amount));
  const currentRoll = current.rollDeg ?? 0;
  const targetRoll = target.rollDeg ?? 0;
  return {
    headingDeg: normalizeDegrees(
      current.headingDeg + signedAngleDifference(target.headingDeg, current.headingDeg) * factor
    ),
    elevationDeg: current.elevationDeg + (target.elevationDeg - current.elevationDeg) * factor,
    rollDeg: normalizeDegrees(
      currentRoll + signedAngleDifference(targetRoll, currentRoll) * factor
    )
  };
}

export function orientationSmoothingFactor(deltaMs: number, responseMs = 110) {
  if (responseMs <= 0) {
    return 1;
  }
  return 1 - Math.exp(-Math.max(0, deltaMs) / responseMs);
}

export function shouldAcceptOrientationSource(
  activeSource: OrientationSource | null,
  incomingSource: OrientationSource,
  millisecondsSinceAbsolute = 0,
  absoluteTimeoutMs = 1000
) {
  return !(
    activeSource === "absolute" &&
    incomingSource === "relative" &&
    millisecondsSinceAbsolute <= absoluteTimeoutMs
  );
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

export function directionFromOrientation(sample: OrientationSample): ViewDirection | null {
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

  const a = alphaDeg * DEG;
  const b = beta * DEG;
  const g = gamma * DEG;
  const cA = Math.cos(a);
  const sA = Math.sin(a);
  const cB = Math.cos(b);
  const sB = Math.sin(b);
  const cG = Math.cos(g);
  const sG = Math.sin(g);

  // W3C device orientation: R = Rz(alpha) Rx(beta) Ry(gamma), mapping device
  // axes into east/north/up. Columns are the device axes in world space.
  const deviceX: Vector3 = {
    x: cA * cG - sA * sB * sG,
    y: sA * cG + cA * sB * sG,
    z: -cB * sG
  };
  const deviceY: Vector3 = { x: -sA * cB, y: cA * cB, z: sB };
  const deviceZ: Vector3 = {
    x: cA * sG + sA * sB * cG,
    y: sA * sG - cA * sB * cG,
    z: cB * cG
  };

  // The rear camera looks along the screen's inward normal.
  const forward: Vector3 = { x: -deviceZ.x, y: -deviceZ.y, z: -deviceZ.z };

  const screenAngle = screenAngleDeg * DEG;
  const cS = Math.cos(screenAngle);
  const sS = Math.sin(screenAngle);
  const screenRight: Vector3 = {
    x: deviceX.x * cS - deviceY.x * sS,
    y: deviceX.y * cS - deviceY.y * sS,
    z: deviceX.z * cS - deviceY.z * sS
  };

  const headingDeg = normalizeDegrees(Math.atan2(forward.x, forward.y) / DEG);
  const elevationDeg = Math.asin(Math.max(-1, Math.min(1, forward.z))) / DEG;

  // Roll measured against the unrolled basis for the same boresight, so
  // viewBasis() reconstructs exactly the axes the device is holding.
  const heading = headingDeg * DEG;
  const level: Vector3 = { x: Math.cos(heading), y: -Math.sin(heading), z: 0 };
  const vertical = cross(level, forward);
  const rollDeg = normalizeDegrees(
    Math.atan2(dot(screenRight, vertical), dot(screenRight, level)) / DEG
  );

  return { headingDeg, elevationDeg, rollDeg };
}

/**
 * Pinhole projection of a look angle onto the stage. A camera image is
 * gnomonic, not linear in angle, so off-axis targets need the tangent rather
 * than a straight degrees-to-pixels ratio.
 */
export function projectLookAngle(
  azimuthDeg: number,
  elevationDeg: number,
  view: ViewDirection,
  width: number,
  height: number,
  fov: FieldOfView = stageFieldOfView(width, height)
): ProjectedPoint {
  const basis = viewBasis(view);
  const target = directionVector(azimuthDeg, elevationDeg);
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
