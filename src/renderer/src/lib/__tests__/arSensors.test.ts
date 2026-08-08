import { describe, expect, it } from "vitest";
import {
  quaternionFromView,
  signedAngleDifference,
  viewFromQuaternion,
  type Quaternion
} from "../ar";
import { CompassGyroFusion } from "../arSensors";

const pose = (headingDeg: number): Quaternion =>
  quaternionFromView({ headingDeg, elevationDeg: 0, rollDeg: 0 });

const headingOf = (quaternion: Quaternion) => viewFromQuaternion(quaternion).headingDeg;

const STEP_MS = 1000 / 30;

describe("compass-gyro fusion", () => {
  it("passes the gyro stream through before any compass fix", () => {
    const fusion = new CompassGyroFusion();
    fusion.updateRelative(pose(30), 0);
    const output = fusion.output(0);
    expect(output?.anchored).toBe(false);
    expect(headingOf(output!.quaternion)).toBeCloseTo(30, 5);
  });

  it("snaps onto the first compass fix", () => {
    const fusion = new CompassGyroFusion();
    // Gyro frame zeroed at an arbitrary heading; compass knows better.
    fusion.updateRelative(pose(0), 0);
    fusion.updateAbsolute(pose(90), 0);
    const output = fusion.output(0);
    expect(output?.anchored).toBe(true);
    expect(headingOf(output!.quaternion)).toBeCloseTo(90, 4);
  });

  it("goes stale without fresh gyro samples", () => {
    const fusion = new CompassGyroFusion();
    fusion.updateRelative(pose(0), 0);
    expect(fusion.output(0)).not.toBeNull();
    expect(fusion.output(5000)).toBeNull();
  });

  it("barely moves on a transient compass spike", () => {
    // The scenario from the field recording: the device is held still, the
    // magnetometer heading suddenly swings 35 degrees for a fraction of a
    // second, then comes back. Raw compass following made the whole overlay
    // thrash; the anchor's slew limit must cap the excursion to a degree or two.
    const fusion = new CompassGyroFusion();
    let now = 0;
    const settleUntil = 2000;
    while (now <= settleUntil) {
      fusion.updateRelative(pose(0), now);
      fusion.updateAbsolute(pose(90), now);
      now += STEP_MS;
    }

    let maxDeviation = 0;
    const spikeUntil = now + 400;
    while (now <= spikeUntil) {
      fusion.updateRelative(pose(0), now);
      fusion.updateAbsolute(pose(125), now);
      maxDeviation = Math.max(
        maxDeviation,
        Math.abs(signedAngleDifference(headingOf(fusion.output(now)!.quaternion), 90))
      );
      now += STEP_MS;
    }
    const recoverUntil = now + 3000;
    while (now <= recoverUntil) {
      fusion.updateRelative(pose(0), now);
      fusion.updateAbsolute(pose(90), now);
      maxDeviation = Math.max(
        maxDeviation,
        Math.abs(signedAngleDifference(headingOf(fusion.output(now)!.quaternion), 90))
      );
      now += STEP_MS;
    }

    expect(maxDeviation).toBeLessThan(3.5);
  });

  it("corrects steady gyro drift toward the compass", () => {
    // Device physically still, compass steady at 90, but the gyro frame
    // wanders a full degree per second. The anchor must absorb it.
    const fusion = new CompassGyroFusion();
    const driftDegPerSec = 1;
    let worstAfterSettle = 0;
    for (let now = 0; now <= 10_000; now += STEP_MS) {
      fusion.updateRelative(pose((driftDegPerSec * now) / 1000), now);
      fusion.updateAbsolute(pose(90), now);
      if (now > 2000) {
        worstAfterSettle = Math.max(
          worstAfterSettle,
          Math.abs(signedAngleDifference(headingOf(fusion.output(now)!.quaternion), 90))
        );
      }
    }
    expect(worstAfterSettle).toBeLessThan(2);
  });

  it("ignores the compass entirely while the device is turning", () => {
    // Mid-pan the compass fix and the gyro pose are sampled at different
    // instants, so even a healthy compass appears to lag by tens of degrees.
    // Following it produced the big swings during smooth pans; the motion
    // gate must hold the anchor and let the gyro carry the view alone.
    const fusion = new CompassGyroFusion();
    let now = 0;
    while (now <= 2000) {
      fusion.updateRelative(pose(0), now);
      fusion.updateAbsolute(pose(90), now);
      now += STEP_MS;
    }

    const panStart = now;
    const panRateDegPerSec = 120;
    const compassLagDeg = 35;
    let worstDuringPan = 0;
    while (now <= panStart + 1200) {
      const t = (now - panStart) / 1000;
      fusion.updateRelative(pose(panRateDegPerSec * t), now);
      fusion.updateAbsolute(pose(90 + panRateDegPerSec * t - compassLagDeg), now);
      worstDuringPan = Math.max(
        worstDuringPan,
        Math.abs(
          signedAngleDifference(
            headingOf(fusion.output(now)!.quaternion),
            90 + panRateDegPerSec * t
          )
        )
      );
      now += STEP_MS;
    }
    expect(worstDuringPan).toBeLessThan(0.5);

    // Once still again the compass agrees with the gyro view; nothing jumps.
    const heldRelativeDeg = (panRateDegPerSec * (now - panStart)) / 1000;
    let worstAfterPan = 0;
    const holdUntil = now + 2000;
    while (now <= holdUntil) {
      fusion.updateRelative(pose(heldRelativeDeg), now);
      fusion.updateAbsolute(pose(90 + heldRelativeDeg), now);
      worstAfterPan = Math.max(
        worstAfterPan,
        Math.abs(
          signedAngleDifference(
            headingOf(fusion.output(now)!.quaternion),
            90 + heldRelativeDeg
          )
        )
      );
      now += STEP_MS;
    }
    expect(worstAfterPan).toBeLessThan(0.5);
  });

  it("discards compass fixes flagged as inaccurate", () => {
    // iOS reports webkitCompassAccuracy: negative means invalid, large means
    // the magnetometer needs calibration. Neither may steer the view.
    const fusion = new CompassGyroFusion();
    let now = 0;
    while (now <= 1000) {
      fusion.updateRelative(pose(0), now);
      fusion.updateAbsolute(pose(90), now, 10);
      now += STEP_MS;
    }

    let worst = 0;
    const badUntil = now + 3000;
    while (now <= badUntil) {
      fusion.updateRelative(pose(0), now);
      fusion.updateAbsolute(pose(150), now, now % 2 === 0 ? -1 : 80);
      worst = Math.max(
        worst,
        Math.abs(signedAngleDifference(headingOf(fusion.output(now)!.quaternion), 90))
      );
      now += STEP_MS;
    }
    expect(worst).toBeLessThan(0.01);

    // Trusted fixes still steer as usual.
    const goodUntil = now + 4000;
    while (now <= goodUntil) {
      fusion.updateRelative(pose(0), now);
      fusion.updateAbsolute(pose(95), now, 5);
      now += STEP_MS;
    }
    expect(
      Math.abs(signedAngleDifference(headingOf(fusion.output(now - STEP_MS)!.quaternion), 95))
    ).toBeLessThan(1);
  });

  it("holds the anchor rock-steady through violent shaking", () => {
    // The user's benchmark: the native iPhone Compass app survives extreme
    // shaking without moving a degree. Shaking means high angular speed, so
    // the motion gate freezes the anchor and the gyro tracks the shake; the
    // pointing must come back exactly where it was.
    const fusion = new CompassGyroFusion();
    let now = 0;
    while (now <= 2000) {
      fusion.updateRelative(pose(0), now);
      fusion.updateAbsolute(pose(90), now);
      now += STEP_MS;
    }

    // 4 Hz shake, ±25 degrees, with the compass output thrashing wildly.
    const shakeUntil = now + 3000;
    const shakeStart = now;
    while (now <= shakeUntil) {
      const t = (now - shakeStart) / 1000;
      const wobble = 25 * Math.sin(2 * Math.PI * 4 * t);
      fusion.updateRelative(pose(wobble), now);
      fusion.updateAbsolute(pose(90 + 40 * Math.sin(2 * Math.PI * 7 * t)), now);
      now += STEP_MS;
    }

    // Settle still again; heading must return to 90 essentially immediately.
    const settleUntil = now + 1000;
    while (now <= settleUntil) {
      fusion.updateRelative(pose(0), now);
      fusion.updateAbsolute(pose(90), now);
      now += STEP_MS;
    }
    expect(
      Math.abs(signedAngleDifference(headingOf(fusion.output(now - STEP_MS)!.quaternion), 90))
    ).toBeLessThan(0.5);
  });

  it("re-snaps after a persistent gyro frame reset", () => {
    // A tab resume or sensor restart re-zeroes the relative stream, which
    // looks like a huge persistent correction error. Slew-limiting through
    // 120 degrees would take half a minute; the fusion snaps instead.
    const fusion = new CompassGyroFusion();
    let now = 0;
    while (now <= 1000) {
      fusion.updateRelative(pose(0), now);
      fusion.updateAbsolute(pose(90), now);
      now += STEP_MS;
    }
    const resetUntil = now + 3500;
    while (now <= resetUntil) {
      fusion.updateRelative(pose(120), now);
      fusion.updateAbsolute(pose(90), now);
      now += STEP_MS;
    }
    expect(
      Math.abs(signedAngleDifference(headingOf(fusion.output(now - STEP_MS)!.quaternion), 90))
    ).toBeLessThan(2);
  });
});
