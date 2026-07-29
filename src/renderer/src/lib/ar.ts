export interface ViewDirection {
  headingDeg: number;
  elevationDeg: number;
}

export type OrientationSource = "absolute" | "relative";

export function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

export function signedAngleDifference(targetDeg: number, originDeg: number) {
  return ((targetDeg - originDeg + 540) % 360) - 180;
}

export function interpolateViewDirection(
  current: ViewDirection,
  target: ViewDirection,
  amount: number
): ViewDirection {
  const factor = Math.max(0, Math.min(1, amount));
  return {
    headingDeg: normalizeDegrees(
      current.headingDeg + signedAngleDifference(target.headingDeg, current.headingDeg) * factor
    ),
    elevationDeg: current.elevationDeg + (target.elevationDeg - current.elevationDeg) * factor
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

export function directionFromOrientation(
  alpha: number | null,
  beta: number | null,
  webkitCompassHeading?: number
): ViewDirection | null {
  if (beta === null || (alpha === null && webkitCompassHeading === undefined)) {
    return null;
  }

  const headingDeg = webkitCompassHeading === undefined
    ? normalizeDegrees(360 - (alpha ?? 0))
    : normalizeDegrees(webkitCompassHeading);

  return {
    headingDeg,
    elevationDeg: Math.max(-90, Math.min(90, beta - 90))
  };
}

export function projectLookAngle(
  azimuthDeg: number,
  elevationDeg: number,
  view: ViewDirection,
  width: number,
  height: number,
  horizontalFovDeg = 58,
  verticalFovDeg = 72
) {
  const deltaAz = signedAngleDifference(azimuthDeg, view.headingDeg);
  const deltaEl = elevationDeg - view.elevationDeg;

  return {
    x: width / 2 + (deltaAz / horizontalFovDeg) * width,
    y: height / 2 - (deltaEl / verticalFovDeg) * height,
    visible:
      Math.abs(deltaAz) <= horizontalFovDeg / 2 &&
      Math.abs(deltaEl) <= verticalFovDeg / 2
  };
}
