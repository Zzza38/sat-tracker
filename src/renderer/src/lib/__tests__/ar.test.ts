import { describe, expect, it } from "vitest";
import {
  AngleFilter,
  OrientationFilter,
  applyHeadingTrim,
  directionFromOrientation,
  dishFaceElevation,
  interpolateLookAngles,
  offAxisAngleDeg,
  projectLookAngle,
  quaternionFromSample,
  quaternionFromView,
  quatSlerp,
  selectNextLookPass,
  shouldAcceptOrientationSample,
  signedAngleDifference,
  stageFieldOfView,
  viewBasis,
  viewFromQuaternion,
  type Quaternion,
  type ViewDirection
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

  it("round-trips a view through its quaternion", () => {
    const poses: ViewDirection[] = [
      { headingDeg: 0, elevationDeg: 0, rollDeg: 0 },
      { headingDeg: 137.5, elevationDeg: 42, rollDeg: 12 },
      { headingDeg: 300, elevationDeg: -35, rollDeg: 351 },
      { headingDeg: 89, elevationDeg: 78, rollDeg: 180 }
    ];
    for (const pose of poses) {
      const roundTripped = viewFromQuaternion(quaternionFromView(pose));
      expect(roundTripped.headingDeg).toBeCloseTo(pose.headingDeg, 5);
      expect(roundTripped.elevationDeg).toBeCloseTo(pose.elevationDeg, 5);
      expect(roundTripped.rollDeg).toBeCloseTo(pose.rollDeg ?? 0, 5);
    }
  });

  it("swings the heading clockwise for a positive compass trim", () => {
    const q = quaternionFromView({ headingDeg: 100, elevationDeg: 25, rollDeg: 5 });
    const trimmed = viewFromQuaternion(applyHeadingTrim(q, 7.5));

    expect(trimmed.headingDeg).toBeCloseTo(107.5, 5);
    expect(trimmed.elevationDeg).toBeCloseTo(25, 5);
    expect(trimmed.rollDeg).toBeCloseTo(5, 5);
  });

  it("slerps across north on the short arc", () => {
    const a = quaternionFromView({ headingDeg: 350, elevationDeg: 0, rollDeg: 0 });
    const b = quaternionFromView({ headingDeg: 10, elevationDeg: 0, rollDeg: 0 });
    const mid = viewFromQuaternion(quatSlerp(a, b, 0.5));

    expect(mid.headingDeg).toBeCloseTo(0, 4);
    expect(mid.elevationDeg).toBeCloseTo(0, 4);
  });

  it("measures the boresight-to-target separation", () => {
    const view: ViewDirection = { headingDeg: 180, elevationDeg: 20 };
    expect(offAxisAngleDeg(view, 180, 20)).toBeCloseTo(0);
    expect(offAxisAngleDeg(view, 180, 50)).toBeCloseTo(30);
  });

  it("prefers better orientation sources and only degrades once stale", () => {
    expect(shouldAcceptOrientationSample(null, "relative")).toBe(true);
    expect(shouldAcceptOrientationSample("absolute", "fused")).toBe(true);
    expect(shouldAcceptOrientationSample("fused", "absolute", 200)).toBe(false);
    expect(shouldAcceptOrientationSample("absolute", "relative", 200)).toBe(false);
    expect(shouldAcceptOrientationSample("absolute", "relative", 2000)).toBe(true);
    expect(shouldAcceptOrientationSample("fused", "fused")).toBe(true);
  });

  it("subtracts an offset dish angle from the boresight elevation", () => {
    expect(dishFaceElevation(42, 22.5)).toBe(19.5);
  });

  it("interpolates satellite look angles on the sphere", () => {
    const mid = interpolateLookAngles(
      { azimuthDeg: 350, elevationDeg: 10, rangeKm: 1000 },
      { azimuthDeg: 10, elevationDeg: 20, rangeKm: 1200 },
      0.5
    );

    // Across north the short way, not the 340-degree detour.
    expect(Math.abs(signedAngleDifference(mid.azimuthDeg, 0))).toBeLessThan(0.5);
    expect(mid.elevationDeg).toBeGreaterThan(10);
    expect(mid.elevationDeg).toBeLessThan(20);
    expect(mid.rangeKm).toBeCloseTo(1100);
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

  it("picks the next look by future AOS, not an in-progress pass with LOS ahead", () => {
    const now = "2026-07-30T12:00:00.000Z";
    const inProgress = {
      aos: "2026-07-30T11:55:00.000Z",
      los: "2026-07-30T12:05:00.000Z"
    };
    const upcoming = {
      aos: "2026-07-30T14:10:00.000Z",
      los: "2026-07-30T14:18:00.000Z"
    };

    // Filtering on LOS would wrongly keep the in-progress pass and surface its
    // already-past acquisition time as the "next" look window.
    expect(selectNextLookPass([inProgress, upcoming], now)).toBe(upcoming);
    expect(selectNextLookPass([inProgress], now)).toBeNull();
    expect(selectNextLookPass([upcoming], now)).toBe(upcoming);
  });
});

describe("orientation filter", () => {
  const pose = (headingDeg: number): Quaternion =>
    quaternionFromView({ headingDeg, elevationDeg: 0, rollDeg: 0 });

  it("snaps to the first fix instead of easing in from north", () => {
    const filter = new OrientationFilter();
    const out = viewFromQuaternion(filter.update(pose(213), 0));
    expect(out.headingDeg).toBeCloseTo(213, 5);
  });

  it("settles onto a static target", () => {
    const filter = new OrientationFilter();
    filter.update(pose(0), 0);
    let latest = pose(0);
    for (let frame = 1; frame <= 150; frame += 1) {
      latest = filter.update(pose(20), frame * (1000 / 60));
    }
    expect(viewFromQuaternion(latest).headingDeg).toBeCloseTo(20, 1);
  });

  it("tracks a fast pan almost without lag", () => {
    // 180 deg/s sweep at 60 fps: the adaptive cutoff must open up so the
    // overlay stays pinned to the camera; a fixed low-pass would trail by
    // tens of degrees, which is the "half a second behind" complaint.
    const filter = new OrientationFilter();
    const frameMs = 1000 / 60;
    let filtered = filter.update(pose(0), 0);
    let heading = 0;
    for (let frame = 1; frame <= 120; frame += 1) {
      heading = (frame * frameMs * 0.18) % 360; // 180 deg/s
      filtered = filter.update(pose(heading), frame * frameMs);
    }
    const lag = Math.abs(
      signedAngleDifference(heading, viewFromQuaternion(filtered).headingDeg)
    );
    expect(lag).toBeLessThan(8);
  });

  it("suppresses sensor jitter while holding still", () => {
    const filter = new OrientationFilter();
    const frameMs = 1000 / 60;
    filter.update(pose(90), 0);
    let minHeading = 90;
    let maxHeading = 90;
    const noiseAmplitude = 0.6;
    for (let frame = 1; frame <= 240; frame += 1) {
      // Alternating compass noise around a fixed pose - the worst case for an
      // adaptive filter, since jitter masquerades as fast motion. The jitter
      // pre-stage exists precisely so this noise never reaches the adaptive
      // cutoff's speed estimate.
      const noisy = 90 + (frame % 2 === 0 ? noiseAmplitude : -noiseAmplitude);
      const out = viewFromQuaternion(filter.update(pose(noisy), frame * frameMs));
      if (frame > 60) {
        minHeading = Math.min(minHeading, out.headingDeg);
        maxHeading = Math.max(maxHeading, out.headingDeg);
      }
    }
    // The raw stream wobbles across the full 2x amplitude; the filtered one
    // must be at least eight times steadier even in this pathological case.
    expect(maxHeading - minHeading).toBeLessThan((2 * noiseAmplitude) / 8);
  });

  it("keeps a small deliberate movement smooth, not snappy", () => {
    // A 10-degree turn over half a second - the gesture the ribbon has to
    // render as a glide rather than a jerk.
    const filter = new OrientationFilter();
    const frameMs = 1000 / 60;
    filter.update(pose(0), 0);
    let previousHeading = 0;
    let maxFrameStep = 0;
    for (let frame = 1; frame <= 60; frame += 1) {
      const target = Math.min(10, (frame * frameMs / 500) * 10);
      const out = viewFromQuaternion(filter.update(pose(target), frame * frameMs));
      maxFrameStep = Math.max(
        maxFrameStep,
        Math.abs(signedAngleDifference(out.headingDeg, previousHeading))
      );
      previousHeading = out.headingDeg;
    }
    // The input moves ~0.33 deg/frame; the output must never step much faster
    // than that (a raw pass-through of stepped sensor events would).
    expect(maxFrameStep).toBeLessThan(0.6);
    // And it must still arrive: within a degree shortly after the gesture.
    expect(Math.abs(signedAngleDifference(previousHeading, 10))).toBeLessThan(1.5);
  });
});

describe("ribbon heading filter", () => {
  it("follows a steady turn closely", () => {
    const filter = new AngleFilter();
    const frameMs = 1000 / 60;
    filter.update(0, 0);
    let target = 0;
    let output = 0;
    for (let frame = 1; frame <= 180; frame += 1) {
      target = (frame * frameMs * 0.045) % 360; // 45 deg/s
      output = filter.update(target, frame * frameMs);
    }
    expect(Math.abs(signedAngleDifference(target, output))).toBeLessThan(6);
  });

  it("wraps across north without unwinding", () => {
    const filter = new AngleFilter();
    const frameMs = 1000 / 60;
    filter.update(340, 0);
    let output = 340;
    for (let frame = 1; frame <= 120; frame += 1) {
      const target = (340 + frame * frameMs * 0.03) % 360; // 30 deg/s through 0
      output = filter.update(target, frame * frameMs);
    }
    expect(Math.abs(signedAngleDifference(output, 40))).toBeLessThan(6);
  });

  it("damps wobble much harder when the elevation scale shrinks", () => {
    // cos(elevation) scale: pointing up amplifies heading wobble, so the same
    // wobble must come out far steadier when the scale is low.
    const measureRange = (scale: number) => {
      const filter = new AngleFilter();
      const frameMs = 1000 / 60;
      filter.update(200, 0);
      let min = 200;
      let max = 200;
      for (let frame = 1; frame <= 300; frame += 1) {
        const wobbly = 200 + (frame % 2 === 0 ? 4 : -4);
        const out = filter.update(wobbly, frame * frameMs, scale);
        if (frame > 100) {
          min = Math.min(min, out);
          max = Math.max(max, out);
        }
      }
      return max - min;
    };

    const steepAim = measureRange(0.3);
    const levelAim = measureRange(1);
    expect(steepAim).toBeLessThan(levelAim / 3);
    expect(steepAim).toBeLessThan(0.2);
  });
});

describe("orientation samples", () => {
  it("produces unit quaternions for arbitrary event angles", () => {
    const q = quaternionFromSample({ alpha: 300, beta: 65, gamma: -20, screenAngleDeg: 90 });
    expect(q).not.toBeNull();
    const { x, y, z, w } = q as Quaternion;
    expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 9);
  });

  it("keeps the flat-on-a-table pose pointing straight down for the rear camera", () => {
    // Identity orientation: device flat, screen up. The rear camera looks at
    // the floor, so elevation must be -90 regardless of screen rotation.
    const q = quaternionFromSample({ alpha: 0, beta: 0, gamma: 0, screenAngleDeg: 90 });
    const view = viewFromQuaternion(q as Quaternion);
    expect(view.elevationDeg).toBeCloseTo(-90, 5);
  });
});
