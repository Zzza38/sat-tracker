import { describe, expect, it, vi } from "vitest";
import {
  canAccessOrientationSensors,
  detectOrientationHardware,
  type OrientationProbeHost
} from "../arCapability";

function iosOrientationEvent() {
  const DeviceOrientationEvent = class DeviceOrientationEvent {};
  (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission =
    async () => "granted";
  return DeviceOrientationEvent;
}

function createHost(overrides: Partial<OrientationProbeHost> = {}) {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const host: OrientationProbeHost = {
    DeviceOrientationEvent: class DeviceOrientationEvent {},
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    setTimeout,
    clearTimeout,
    ...overrides
  };
  return { host, listeners };
}

function emit(
  listeners: Map<string, Set<(event: Event) => void>>,
  type: string,
  sample: { alpha: number | null; beta: number | null; gamma: number | null }
) {
  for (const listener of listeners.get(type) ?? []) {
    listener(sample as DeviceOrientationEvent);
  }
}

describe("orientation sensor capability", () => {
  it("does not use constructor presence as proof of hardware", () => {
    expect(canAccessOrientationSensors(class DeviceOrientationEvent {})).toBe(false);
  });

  it("treats the iOS motion-permission API as hardware, not a phone-sized screen", () => {
    expect(canAccessOrientationSensors(iosOrientationEvent())).toBe(true);
  });

  it("detects iOS immediately without waiting for a sample", async () => {
    const { host } = createHost({ DeviceOrientationEvent: iosOrientationEvent() });
    await expect(detectOrientationHardware(host, 20)).resolves.toBe(true);
  });

  it("shows AR after a real deviceorientation sample, including on a desktop UA", async () => {
    const { host, listeners } = createHost();
    const pending = detectOrientationHardware(host, 200);
    emit(listeners, "deviceorientation", { alpha: 12, beta: 40, gamma: 0 });
    await expect(pending).resolves.toBe(true);
  });

  it("ignores null orientation stubs that desktop browsers fire without a gyro", async () => {
    vi.useFakeTimers();
    try {
      const { host, listeners } = createHost();
      const pending = detectOrientationHardware(host, 50);
      emit(listeners, "deviceorientation", { alpha: null, beta: null, gamma: null });
      const expectation = expect(pending).resolves.toBe(false);
      await vi.advanceTimersByTimeAsync(50);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows AR when AbsoluteOrientationSensor produces a reading", async () => {
    class FakeSensor {
      private reading: Array<() => void> = [];
      addEventListener(type: "reading" | "error", listener: () => void) {
        if (type === "reading") {
          this.reading.push(listener);
        }
      }
      start() {
        this.reading.forEach((listener) => listener());
      }
      stop() {}
    }

    const { host } = createHost({
      AbsoluteOrientationSensor: FakeSensor
    });
    await expect(detectOrientationHardware(host, 200)).resolves.toBe(true);
  });

  it("hides AR when no API can produce a heading", async () => {
    const { host } = createHost({
      DeviceOrientationEvent: undefined,
      AbsoluteOrientationSensor: undefined
    });
    await expect(detectOrientationHardware(host, 20)).resolves.toBe(false);
  });
});
