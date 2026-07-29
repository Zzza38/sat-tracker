import { describe, expect, it } from "vitest";
import {
  directionFromOrientation,
  dishFaceElevation,
  interpolateViewDirection,
  orientationSmoothingFactor,
  projectLookAngle,
  shouldAcceptOrientationSource,
  signedAngleDifference,
  stageFieldOfView,
  viewBasis
} from "../ar";

describe("AR pointing math", () => {
  it("wraps heading differences across north", () => {
    expect(signedAngleDifference(2, 358)).toBe(4);
    expect(signedAngleDifference(358, 2)).toBe(-4);
  });

  it("converts portrait device orientation to a view direction", () => {
    const direction = directionFromOrientation({ alpha: 270, beta: 100, gamma: 0 });
    expect(direction?.headingDeg).toBeCloseTo(90);
    expect(direction?.elevationDeg).toBeCloseTo(10);
    expect(direction?.rollDeg).toBeCloseTo(0);
  });

  it("uses the iOS compass heading when available", () => {
    expect(
      directionFromOrientation({ alpha: 20, beta: 90, gamma: 0, compassHeading: 184 })?.headingDeg
    ).toBeCloseTo(184);
  });

  it("needs a full three-axis sample", () => {
    expect(directionFromOrientation({ alpha: 10, beta: 90, gamma: null })).toBeNull();
    expect(directionFromOrientation({ alpha: null, beta: 90, gamma: 0 })).toBeNull();
  });

  it("keeps the boresight steady when the device is rolled onto its side", () => {
    // Camera still aimed level at true north, but the phone is turned onto its
    // side. beta is 0 here, so reading elevation as `beta - 90` claimed the
    // camera was pointing straight down.
    const direction = directionFromOrientation({ alpha: 270, beta: 0, gamma: 90 });

    expect(direction?.headingDeg).toBeCloseTo(0);
    expect(direction?.elevationDeg).toBeCloseTo(0);
    expect(direction?.rollDeg).toBeCloseTo(270);
  });

  it("cancels the roll once the screen has rotated to match", () => {
    // Same physical pose; the browser has rotated the viewport to landscape, so
    // the overlay is already upright on screen and needs no extra roll.
    const direction = directionFromOrientation({
      alpha: 270,
      beta: 0,
      gamma: 90,
      screenAngleDeg: 270
    });

    expect(direction?.headingDeg).toBeCloseTo(0);
    expect(direction?.elevationDeg).toBeCloseTo(0);
    expect(direction?.rollDeg).toBeCloseTo(0);
  });

  it("builds an orthonormal camera basis", () => {
    const basis = viewBasis({ headingDeg: 143, elevationDeg: -23, rollDeg: 17 });
    const dot = (a: typeof basis.right, b: typeof basis.right) =>
      a.x * b.x + a.y * b.y + a.z * b.z;

    expect(dot(basis.forward, basis.forward)).toBeCloseTo(1);
    expect(dot(basis.right, basis.right)).toBeCloseTo(1);
    expect(dot(basis.up, basis.up)).toBeCloseTo(1);
    expect(dot(basis.forward, basis.right)).toBeCloseTo(0);
    expect(dot(basis.forward, basis.up)).toBeCloseTo(0);
    expect(dot(basis.right, basis.up)).toBeCloseTo(0);
  });

  it("smooths across north using the short circular path", () => {
    const result = interpolateViewDirection(
      { headingDeg: 359, elevationDeg: 0 },
      { headingDeg: 1, elevationDeg: 20 },
      0.25
    );

    expect(result.headingDeg).toBeCloseTo(359.5);
    expect(result.elevationDeg).toBe(5);
  });

  it("uses frame time to keep smoothing consistent across refresh rates", () => {
    expect(orientationSmoothingFactor(0)).toBe(0);
    expect(orientationSmoothingFactor(110, 110)).toBeCloseTo(1 - Math.exp(-1));
    expect(orientationSmoothingFactor(1000)).toBeGreaterThan(0.99);
  });

  it("closes 90% of the gap within 100ms at any frame rate", () => {
    const remainingAfter = (frameMs: number, totalMs: number) => {
      let remaining = 1;
      for (let elapsed = 0; elapsed < totalMs; elapsed += frameMs) {
        remaining *= 1 - orientationSmoothingFactor(frameMs);
      }
      return remaining;
    };

    // The old 110ms response left ~40% of the gap outstanding at this point,
    // which is the tail that read as the overlay trailing the camera.
    expect(remainingAfter(1000 / 60, 100)).toBeLessThan(0.1);
    expect(remainingAfter(1000 / 30, 100)).toBeLessThan(0.1);
    expect(remainingAfter(1000 / 60, 100)).toBeCloseTo(remainingAfter(1000 / 30, 100), 1);
  });

  it("returns the same object once it has caught up, so renders can stop", () => {
    const target = { headingDeg: 159, elevationDeg: -23, rollDeg: 4 };
    let current = { headingDeg: 158.99, elevationDeg: -23, rollDeg: 4 };

    // First call snaps exactly onto the target.
    const snapped = interpolateViewDirection(current, target, 0.5);
    expect(snapped).not.toBe(current);
    expect(snapped.headingDeg).toBe(159);

    // Every later call hands back the identical reference.
    current = snapped as typeof current;
    expect(interpolateViewDirection(current, target, 0.5)).toBe(current);
  });

  it("does not let a relative orientation stream override an absolute compass", () => {
    expect(shouldAcceptOrientationSource("absolute", "relative")).toBe(false);
    expect(shouldAcceptOrientationSource("absolute", "absolute")).toBe(true);
    expect(shouldAcceptOrientationSource("relative", "absolute")).toBe(true);
    expect(shouldAcceptOrientationSource(null, "relative")).toBe(true);
    expect(shouldAcceptOrientationSource("absolute", "relative", 1200)).toBe(true);
  });

  it("subtracts an offset dish angle from the boresight elevation", () => {
    expect(dishFaceElevation(42, 22.5)).toBe(19.5);
  });

  it("projects a centered target to the viewport center", () => {
    expect(projectLookAngle(180, 20, { headingDeg: 180, elevationDeg: 20 }, 400, 800)).toMatchObject({
      x: 200,
      y: 400,
      visible: true
    });
  });

  it("drops targets behind the camera instead of mirroring them on screen", () => {
    const behind = projectLookAngle(0, 0, { headingDeg: 180, elevationDeg: 0 }, 400, 800);
    expect(behind.behind).toBe(true);
    expect(behind.visible).toBe(false);
    expect(Number.isFinite(behind.x)).toBe(true);
  });

  it("scales both stage axes with one focal length", () => {
    // A 3:4 portrait frame covering a taller stage. The overlay is only locked
    // to the scene if a degree is worth the same pixels across and down.
    const fov = stageFieldOfView(376, 666, 1080, 1440, 68);

    const across = projectLookAngle(
      10,
      0,
      { headingDeg: 0, elevationDeg: 0 },
      376,
      666,
      fov
    );
    const down = projectLookAngle(
      0,
      -10,
      { headingDeg: 0, elevationDeg: 0 },
      376,
      666,
      fov
    );

    expect(across.x - 376 / 2).toBeCloseTo(down.y - 666 / 2, 6);
  });

  it("widens the vertical field of view for a tall stage", () => {
    const fov = stageFieldOfView(376, 666, 1080, 1440, 68);

    // `object-fit: cover` on a portrait stage crops the sides and keeps the
    // frame's long edge, so vertical has to be the wider of the two.
    expect(fov.verticalDeg).toBeGreaterThan(fov.horizontalDeg);
    expect(fov.verticalDeg).toBeCloseTo(68, 6);
  });
});
