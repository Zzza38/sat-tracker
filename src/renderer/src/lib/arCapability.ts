/**
 * Whether this device can actually feed the AR finder a heading.
 *
 * Desktop browsers expose `DeviceOrientationEvent` and even
 * `AbsoluteOrientationSensor` when there is no gyro. Treating those
 * constructors as support would show a sky-finder tab that cannot point at
 * anything, so we only opt in for iOS motion permission or a phone / tablet
 * user agent.
 */

export interface OrientationCapabilityHost {
  AbsoluteOrientationSensor?: unknown;
  DeviceOrientationEvent?: unknown;
  userAgent: string;
  maxTouchPoints: number;
}

export function readOrientationCapabilityHost(): OrientationCapabilityHost {
  return {
    AbsoluteOrientationSensor: (
      window as { AbsoluteOrientationSensor?: unknown }
    ).AbsoluteOrientationSensor,
    DeviceOrientationEvent: window.DeviceOrientationEvent,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0
  };
}

export function canAccessOrientationSensors(
  host: OrientationCapabilityHost = readOrientationCapabilityHost()
): boolean {
  const orientation = host.DeviceOrientationEvent as
    | { requestPermission?: unknown }
    | undefined;

  // Chrome desktop ships AbsoluteOrientationSensor and DeviceOrientationEvent
  // even when the machine has no gyro. Constructor presence is not hardware.
  if (typeof orientation?.requestPermission === "function") {
    return true;
  }

  if (orientation == null && typeof host.AbsoluteOrientationSensor !== "function") {
    return false;
  }

  return isMotionPhone(host);
}

function isMotionPhone(host: OrientationCapabilityHost): boolean {
  if (/Android|iPhone|iPod|Mobile|IEMobile|webOS|BlackBerry|Opera Mini/i.test(host.userAgent)) {
    return true;
  }
  // iPadOS 13+ reports as Macintosh but still has a compass and gyro.
  return /iPad/i.test(host.userAgent) || (/Macintosh/i.test(host.userAgent) && host.maxTouchPoints > 1);
}
