import { describe, expect, it } from "vitest";
import { canAccessOrientationSensors, type OrientationCapabilityHost } from "../arCapability";

const desktop: OrientationCapabilityHost = {
  DeviceOrientationEvent: class DeviceOrientationEvent {},
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0",
  maxTouchPoints: 0
};

describe("orientation sensor capability", () => {
  it("hides AR on desktop browsers that only stub DeviceOrientationEvent", () => {
    expect(canAccessOrientationSensors(desktop)).toBe(false);
  });

  it("hides AR when the orientation API is missing", () => {
    expect(
      canAccessOrientationSensors({
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0",
        maxTouchPoints: 0
      })
    ).toBe(false);
  });

  it("shows AR when the Generic Sensor API is present", () => {
    expect(
      canAccessOrientationSensors({
        ...desktop,
        AbsoluteOrientationSensor: class AbsoluteOrientationSensor {}
      })
    ).toBe(true);
  });

  it("shows AR on iOS, which gates motion behind requestPermission", () => {
    const DeviceOrientationEvent = class DeviceOrientationEvent {};
    (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission =
      async () => "granted";

    expect(
      canAccessOrientationSensors({
        DeviceOrientationEvent,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        maxTouchPoints: 5
      })
    ).toBe(true);
  });

  it("shows AR on Android phones even without AbsoluteOrientationSensor", () => {
    expect(
      canAccessOrientationSensors({
        DeviceOrientationEvent: class DeviceOrientationEvent {},
        userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120.0.0.0 Mobile",
        maxTouchPoints: 5
      })
    ).toBe(true);
  });

  it("shows AR on iPadOS, which reports as Macintosh with touch", () => {
    expect(
      canAccessOrientationSensors({
        DeviceOrientationEvent: class DeviceOrientationEvent {},
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        maxTouchPoints: 5
      })
    ).toBe(true);
  });
});
