/**
 * Whether this device can actually feed the AR finder a heading.
 *
 * Desktop browsers expose `DeviceOrientationEvent` even when there is no gyro
 * or magnetometer. Treating that as support would show a sky-finder tab that
 * cannot point at anything, so we only opt in when the platform advertises
 * real motion hardware: the Generic Sensor API, iOS permission, or a phone /
 * tablet user agent.
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
  if (typeof host.AbsoluteOrientationSensor === "function") {
    return true;
  }

  const orientation = host.DeviceOrientationEvent as
    | { requestPermission?: unknown }
    | undefined;
  if (orientation == null) {
    return false;
  }
  if (typeof orientation.requestPermission === "function") {
    return true;
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
