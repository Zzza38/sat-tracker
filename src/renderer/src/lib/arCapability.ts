/**
 * Whether this device can feed the AR finder a heading.
 *
 * API constructors are not hardware: desktop Chrome ships
 * DeviceOrientationEvent and AbsoluteOrientationSensor without a gyro.
 * Screen size and user-agent are also not hardware. The only sync signal we
 * trust is iOS `requestPermission`. Everywhere else we wait for a real
 * orientation sample (or a Generic Sensor reading) before showing the tab.
 */

export const ORIENTATION_PROBE_TIMEOUT_MS = 800;

export interface OrientationProbeHost {
  DeviceOrientationEvent?: unknown;
  AbsoluteOrientationSensor?: new (options?: { frequency?: number }) => {
    addEventListener(type: "reading" | "error", listener: () => void): void;
    start(): void;
    stop(): void;
  };
  addEventListener(
    type: string,
    listener: (event: Event) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: (event: Event) => void,
    options?: boolean | EventListenerOptions
  ): void;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

function readWindowHost(): OrientationProbeHost {
  return {
    DeviceOrientationEvent: window.DeviceOrientationEvent,
    AbsoluteOrientationSensor: (
      window as { AbsoluteOrientationSensor?: OrientationProbeHost["AbsoluteOrientationSensor"] }
    ).AbsoluteOrientationSensor,
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window)
  };
}

export function hasIosMotionPermissionApi(
  DeviceOrientationEventCtor: unknown = typeof window === "undefined"
    ? undefined
    : window.DeviceOrientationEvent
): boolean {
  return (
    typeof (DeviceOrientationEventCtor as { requestPermission?: unknown } | undefined)
      ?.requestPermission === "function"
  );
}

function hasOrientationSample(event: Event) {
  const sample = event as DeviceOrientationEvent;
  return sample.alpha != null && sample.beta != null && sample.gamma != null;
}

/**
 * Immediate check used for first paint. True only when the platform exposes
 * the iOS motion-permission gate, which is hardware, not a viewport size.
 */
export function canAccessOrientationSensors(
  DeviceOrientationEventCtor?: unknown
): boolean {
  return hasIosMotionPermissionApi(DeviceOrientationEventCtor);
}

/**
 * Resolves true once a real heading sample arrives, or when iOS advertises
 * motion permission. Resolves false if nothing reports before the timeout.
 */
export function detectOrientationHardware(
  host: OrientationProbeHost = readWindowHost(),
  timeoutMs = ORIENTATION_PROBE_TIMEOUT_MS
): Promise<boolean> {
  if (hasIosMotionPermissionApi(host.DeviceOrientationEvent)) {
    return Promise.resolve(true);
  }

  const SensorConstructor = host.AbsoluteOrientationSensor;
  const hasOrientationEvent =
    typeof host.DeviceOrientationEvent === "function" ||
    typeof host.DeviceOrientationEvent === "object";
  if (!hasOrientationEvent && typeof SensorConstructor !== "function") {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let settled = false;
    const timer = { id: undefined as ReturnType<OrientationProbeHost["setTimeout"]> | undefined };
    let sensor: InstanceType<NonNullable<OrientationProbeHost["AbsoluteOrientationSensor"]>> | null =
      null;

    const finish = (available: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer.id !== undefined) {
        host.clearTimeout(timer.id);
      }
      host.removeEventListener("deviceorientation", onOrientation, true);
      host.removeEventListener("deviceorientationabsolute", onOrientation, true);
      if (sensor) {
        try {
          sensor.stop();
        } catch {
          // Already stopped or never started.
        }
      }
      resolve(available);
    };

    const onOrientation = (event: Event) => {
      if (hasOrientationSample(event)) {
        finish(true);
      }
    };

    host.addEventListener("deviceorientation", onOrientation, true);
    host.addEventListener("deviceorientationabsolute", onOrientation, true);

    if (typeof SensorConstructor === "function") {
      try {
        const next = new SensorConstructor({ frequency: 10 });
        next.addEventListener("reading", () => finish(true));
        next.start();
        sensor = next;
      } catch {
        sensor = null;
      }
    }

    timer.id = host.setTimeout(() => finish(false), timeoutMs);
  });
}
