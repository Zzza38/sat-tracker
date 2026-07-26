import { describe, expect, it } from "vitest";
import {
  directionFromOrientation,
  dishFaceElevation,
  interpolateViewDirection,
  orientationSmoothingFactor,
  projectLookAngle,
  shouldAcceptOrientationSource,
  signedAngleDifference
} from "../ar";

describe("AR pointing math", () => {
  it("wraps heading differences across north", () => {
    expect(signedAngleDifference(2, 358)).toBe(4);
    expect(signedAngleDifference(358, 2)).toBe(-4);
  });

  it("converts portrait device orientation to a view direction", () => {
    expect(directionFromOrientation(270, 100)).toEqual({
      headingDeg: 90,
      elevationDeg: 10
    });
  });

  it("uses the iOS compass heading when available", () => {
    expect(directionFromOrientation(20, 90, 184)?.headingDeg).toBe(184);
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
    expect(orientationSmoothingFactor(110)).toBeCloseTo(1 - Math.exp(-1));
    expect(orientationSmoothingFactor(1000)).toBeGreaterThan(0.99);
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
});
