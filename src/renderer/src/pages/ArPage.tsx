import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  BellRing,
  Camera,
  CameraOff,
  Crosshair,
  LocateFixed,
  Move,
  Satellite,
  Settings2
} from "lucide-react";
import { computeOrbitSnapshot } from "@/shared/propagation/engine";
import { predictPassesBulk } from "@/shared/passes/predictor";
import type { OrbitSnapshot, PassPrediction, SatelliteRecord } from "@/shared/types";
import { formatTimestamp } from "@/shared/utils/date";
import { useApp } from "../context/AppContext";
import { useTicker } from "../hooks/useTicker";
import { Button } from "../components/ui/button";
import { Slider } from "../components/ui/slider";
import {
  AngleFilter,
  DEFAULT_CAMERA_FOV_DEG,
  MAX_CAMERA_FOV_DEG,
  MAX_COMPASS_TRIM_DEG,
  MIN_CAMERA_FOV_DEG,
  OrientationFilter,
  applyHeadingTrim,
  dishFaceElevation,
  interpolateLookAngles,
  quaternionFromView,
  selectNextLookPass,
  signedAngleDifference,
  stageFieldOfView,
  viewFromQuaternion,
  type LookAngles,
  type OrientationSource,
  type Quaternion,
  type ViewDirection
} from "../lib/ar";
import { startOrientationStream } from "../lib/arSensors";
import { renderArScene, type ArHitRegion, type ArSceneTarget } from "../lib/arRender";
import {
  hasPassReminder,
  REMINDERS_CHANGED_EVENT,
  togglePassReminder
} from "../lib/passReminders";
import { requestNotificationPermission } from "../lib/platform";

const DISH_OFFSET_KEY = "sat-tracker-dish-offset";
const CAMERA_FOV_KEY = "sat-tracker-camera-fov";
const COMPASS_TRIM_KEY = "sat-tracker-compass-trim";
const MAX_AR_SATELLITES = 12;
const ORBIT_POINTS = 46;
const ORBIT_STEP_SECONDS = 60;
/** Span between the two live propagation samples the frame loop blends. */
const SNAPSHOT_SPAN_MS = 2000;
/** Pass-window quantisation, so the cached prediction is reusable between runs. */
const PASS_WINDOW_BUCKET_MS = 5 * 60_000;
const HUD_UPDATE_INTERVAL_MS = 120;
const DEG = Math.PI / 180;

interface DeviceOrientationPermission {
  requestPermission?: () => Promise<"granted" | "denied">;
}

type OrientationPermissionResult =
  | { permission: "granted" | "denied" }
  | { error: unknown };

interface SkyTarget {
  satellite: SatelliteRecord;
  snapshot: OrbitSnapshot;
  nextSnapshot: OrbitSnapshot | null;
  color: string;
}

type SensorState = "idle" | "pending" | "live" | "unavailable";

const SOURCE_LABELS: Record<OrientationSource, string> = {
  fused: "fused sensors",
  absolute: "compass",
  relative: "gyro only"
};

function readStoredNumber(key: string, fallback: number, min: number, max: number) {
  const raw = localStorage.getItem(key);
  const stored = Number(raw);
  if (raw === null || !Number.isFinite(stored)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, stored));
}

function safeSnapshot(
  satellite: SatelliteRecord,
  date: Date,
  observer: ReturnType<typeof useApp>["observer"]
) {
  try {
    return computeOrbitSnapshot(satellite, date, observer);
  } catch {
    return null;
  }
}

function requestOrientationPermissionFromGesture(): Promise<OrientationPermissionResult> {
  const orientationConstructor = window.DeviceOrientationEvent as unknown as
    | DeviceOrientationPermission
    | undefined;

  if (typeof orientationConstructor?.requestPermission !== "function") {
    return Promise.resolve({ permission: "granted" });
  }

  // iOS only accepts this call while the original button-tap activation is
  // still live. Attach both success and failure handlers immediately so a
  // camera permission prompt cannot turn a rejection into an unhandled one.
  try {
    return orientationConstructor.requestPermission().then(
      (permission) => ({ permission }),
      (error: unknown) => ({ error })
    );
  } catch (error) {
    return Promise.resolve({ error });
  }
}

export function ArPage() {
  const {
    satellites,
    watchlistIds,
    selectedSatelliteId,
    observer,
    selectSatellite,
    getSatelliteColor,
    setPage
  } = useApp();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const orientationStopRef = useRef<(() => void) | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const sensorTimeoutRef = useRef<number | null>(null);

  const filterRef = useRef(new OrientationFilter());
  const ribbonHeadingFilterRef = useRef(new AngleFilter());
  const sensorSampleRef = useRef<{ q: Quaternion; source: OrientationSource } | null>(null);
  const sensorSourceRef = useRef<OrientationSource | null>(null);
  const manualViewRef = useRef<ViewDirection>({ headingDeg: 0, elevationDeg: 24, rollDeg: 0 });
  const viewRef = useRef<ViewDirection>({ headingDeg: 0, elevationDeg: 24, rollDeg: 0 });
  const hitRegionsRef = useRef<ArHitRegion[]>([]);
  const lastHudUpdateRef = useRef(0);
  const dragRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const liveNow = useTicker(1000);
  const [arStarted, setArStarted] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [sensorState, setSensorState] = useState<SensorState>("idle");
  const [sensorSource, setSensorSource] = useState<OrientationSource | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState({ width: 390, height: 700 });
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [dishOffset, setDishOffset] = useState(() => readStoredNumber(DISH_OFFSET_KEY, 0, 0, 45));
  const [cameraFov, setCameraFov] = useState(() =>
    readStoredNumber(CAMERA_FOV_KEY, DEFAULT_CAMERA_FOV_DEG, MIN_CAMERA_FOV_DEG, MAX_CAMERA_FOV_DEG)
  );
  const [compassTrim, setCompassTrim] = useState(() =>
    readStoredNumber(COMPASS_TRIM_KEY, 0, -MAX_COMPASS_TRIM_DEG, MAX_COMPASS_TRIM_DEG)
  );
  const [, setReminderRevision] = useState(0);

  const fieldOfView = useMemo(
    () =>
      stageFieldOfView(
        stageSize.width,
        stageSize.height,
        frameSize.width,
        frameSize.height,
        cameraFov
      ),
    [cameraFov, frameSize.height, frameSize.width, stageSize.height, stageSize.width]
  );

  const visibleSatellites = useMemo(() => {
    if (watchlistIds.length === 0) {
      return [];
    }
    const recordsById = new Map(satellites.map((satellite) => [satellite.id, satellite]));
    return watchlistIds
      .flatMap((id) => {
        const satellite = recordsById.get(id);
        return satellite ? [satellite] : [];
      })
      .slice(0, MAX_AR_SATELLITES);
  }, [satellites, watchlistIds]);
  const visibleIds = useMemo(
    () => visibleSatellites.map((satellite) => satellite.id),
    [visibleSatellites]
  );

  // Sky trails only shift meaningfully over tens of seconds, so recompute on a
  // coarse bucket instead of burning 500+ propagations every second.
  const orbitTimeKey = Math.floor(liveNow.getTime() / 30_000);
  const orbitsById = useMemo(() => {
    const start = new Date(orbitTimeKey * 30_000);
    const orbits = new Map<string, LookAngles[]>();
    for (const satellite of visibleSatellites) {
      const points: LookAngles[] = [];
      for (let index = 0; index < ORBIT_POINTS; index += 1) {
        const snapshot = safeSnapshot(
          satellite,
          new Date(start.getTime() + index * ORBIT_STEP_SECONDS * 1000),
          observer
        );
        if (snapshot) {
          points.push({
            azimuthDeg: snapshot.azimuthDeg,
            elevationDeg: snapshot.elevationDeg
          });
        }
      }
      orbits.set(satellite.id, points);
    }
    return orbits;
  }, [observer, orbitTimeKey, visibleSatellites]);

  // Live positions refresh every second; the frame loop interpolates between
  // the two samples so markers glide at display rate instead of stepping.
  const secondKey = Math.floor(liveNow.getTime() / 1000);
  const liveSky = useMemo(() => {
    const now = new Date();
    const targets = visibleSatellites.flatMap((satellite): SkyTarget[] => {
      const snapshot = safeSnapshot(satellite, now, observer);
      if (!snapshot) {
        return [];
      }
      const nextSnapshot = safeSnapshot(
        satellite,
        new Date(now.getTime() + SNAPSHOT_SPAN_MS),
        observer
      );
      return [
        {
          satellite,
          snapshot,
          nextSnapshot,
          color: getSatelliteColor(satellite.id, visibleIds)
        }
      ];
    });
    return { targets, epochMs: now.getTime() };
  }, [getSatelliteColor, observer, secondKey, visibleIds, visibleSatellites]);
  const skyTargets = liveSky.targets;
  const focus =
    skyTargets.find((target) => target.satellite.id === selectedSatelliteId) ?? skyTargets[0];
  const focusSatellite = focus?.satellite;

  // A seven-day scan is ~20k propagations. Run it on the shared prediction
  // worker instead of the render thread, and quantise the window so repeat
  // runs hit the prediction cache rather than recomputing every tick.
  const passWindowStart =
    Math.floor(liveNow.getTime() / PASS_WINDOW_BUCKET_MS) * PASS_WINDOW_BUCKET_MS;
  const [predictedPasses, setPredictedPasses] = useState<PassPrediction[]>([]);

  useEffect(() => {
    if (!focusSatellite) {
      setPredictedPasses([]);
      return;
    }

    let cancelled = false;
    predictPassesBulk([focusSatellite], observer, {
      start: new Date(passWindowStart),
      end: new Date(passWindowStart + 7 * 86_400_000),
      minElevationDeg: observer.minElevationDeg,
      stepSeconds: 30
    })
      .then((passes) => {
        if (!cancelled) {
          setPredictedPasses(passes);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPredictedPasses([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [focusSatellite, observer, passWindowStart]);

  const nextPass = useMemo(
    () => selectNextLookPass(predictedPasses, new Date(secondKey * 1000).toISOString()),
    [predictedPasses, secondKey]
  );
  const reminderSet = nextPass ? hasPassReminder(nextPass) : false;

  // --- Refs mirroring the latest render state for the frame loop -----------

  const frameStateRef = useRef({
    stageSize,
    fieldOfView,
    dishOffset,
    compassTrim,
    manualMode,
    focusId: focus?.satellite.id ?? null,
    liveSky,
    orbitsById,
    nextPass
  });
  frameStateRef.current = {
    stageSize,
    fieldOfView,
    dishOffset,
    compassTrim,
    manualMode,
    focusId: focus?.satellite.id ?? null,
    liveSky,
    orbitsById,
    nextPass
  };

  const hudAzRef = useRef<HTMLElement | null>(null);
  const hudElRef = useRef<HTMLElement | null>(null);
  const hudRangeRef = useRef<HTMLElement | null>(null);
  const hudDishRef = useRef<HTMLElement | null>(null);
  const hudGuidanceRef = useRef<HTMLDivElement | null>(null);

  // --- Stage / canvas plumbing ----------------------------------------------

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (entry) {
        setStageSize({
          width: Math.max(1, entry.contentRect.width),
          height: Math.max(1, entry.contentRect.height)
        });
      }
    });
    resizeObserver.observe(stage);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(stageSize.width * dpr);
    canvas.height = Math.round(stageSize.height * dpr);
  }, [stageSize]);

  useEffect(() => {
    const refresh = () => setReminderRevision((value) => value + 1);
    window.addEventListener(REMINDERS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(REMINDERS_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      orientationStopRef.current?.();
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (sensorTimeoutRef.current !== null) {
        window.clearTimeout(sensorTimeoutRef.current);
      }
    };
  }, []);

  // --- Frame loop -------------------------------------------------------------

  const renderFrame = useCallback((frameTimeMs: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }
    const state = frameStateRef.current;
    const { width, height } = state.stageSize;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Orientation: manual aim and the sensor stream share one filtered path.
    const sensorSample = sensorSampleRef.current;
    const useManual = state.manualMode || sensorSample === null;
    const targetQuaternion = useManual
      ? quaternionFromView(manualViewRef.current)
      : applyHeadingTrim(sensorSample.q, state.compassTrim);
    const filtered = filterRef.current.update(targetQuaternion, frameTimeMs);
    const view = viewFromQuaternion(filtered);
    viewRef.current = view;

    // The ribbon heading gets its own smoothing, scaled by cos(elevation):
    // pointing the camera up amplifies heading wobble by 1/cos(elevation), so
    // the readout is damped harder exactly when the geometry misbehaves.
    const ribbonHeadingDeg = ribbonHeadingFilterRef.current.update(
      view.headingDeg,
      frameTimeMs,
      Math.abs(Math.cos(view.elevationDeg * DEG))
    );

    // Satellites: blend the two 1 Hz propagation samples up to display rate.
    const blend = (Date.now() - state.liveSky.epochMs) / SNAPSHOT_SPAN_MS;
    const sceneTargets: ArSceneTarget[] = state.liveSky.targets.map((target) => {
      const from: LookAngles = {
        azimuthDeg: target.snapshot.azimuthDeg,
        elevationDeg: target.snapshot.elevationDeg,
        rangeKm: target.snapshot.rangeKm
      };
      const to: LookAngles = target.nextSnapshot
        ? {
            azimuthDeg: target.nextSnapshot.azimuthDeg,
            elevationDeg: target.nextSnapshot.elevationDeg,
            rangeKm: target.nextSnapshot.rangeKm
          }
        : from;
      const look = interpolateLookAngles(from, to, Math.min(1.5, blend));
      return {
        id: target.satellite.id,
        name: target.satellite.name,
        color: target.color,
        selected: target.satellite.id === state.focusId,
        azimuthDeg: look.azimuthDeg,
        elevationDeg: look.elevationDeg,
        rangeKm: look.rangeKm ?? target.snapshot.rangeKm,
        orbit: state.orbitsById.get(target.satellite.id) ?? []
      };
    });

    const focusTarget = sceneTargets.find((target) => target.selected) ?? null;
    const guidanceTarget: LookAngles | null = focusTarget
      ? {
          azimuthDeg: focusTarget.azimuthDeg,
          elevationDeg:
            state.dishOffset > 0
              ? dishFaceElevation(focusTarget.elevationDeg, state.dishOffset)
              : focusTarget.elevationDeg
        }
      : null;

    const result = renderArScene(ctx, {
      width,
      height,
      view,
      fov: state.fieldOfView,
      targets: sceneTargets,
      dishTarget:
        focusTarget && state.dishOffset > 0
          ? {
              azimuthDeg: focusTarget.azimuthDeg,
              elevationDeg: dishFaceElevation(focusTarget.elevationDeg, state.dishOffset)
            }
          : null,
      guidanceTarget,
      ribbonHeadingDeg,
      timeMs: frameTimeMs
    });
    hitRegionsRef.current = result.hits;

    // HUD text runs on the DOM directly - no React work per frame.
    if (frameTimeMs - lastHudUpdateRef.current < HUD_UPDATE_INTERVAL_MS) {
      return;
    }
    lastHudUpdateRef.current = frameTimeMs;

    if (focusTarget) {
      if (hudAzRef.current) {
        hudAzRef.current.textContent = `${focusTarget.azimuthDeg.toFixed(1)}°`;
      }
      if (hudElRef.current) {
        hudElRef.current.textContent = `${focusTarget.elevationDeg.toFixed(1)}°`;
      }
      if (hudRangeRef.current) {
        hudRangeRef.current.textContent = `${Math.round(focusTarget.rangeKm).toLocaleString()} km`;
      }
      if (hudDishRef.current) {
        hudDishRef.current.textContent = `${dishFaceElevation(
          focusTarget.elevationDeg,
          state.dishOffset
        ).toFixed(1)}°`;
      }
      if (hudGuidanceRef.current && guidanceTarget) {
        const aimBelowHorizon = guidanceTarget.elevationDeg < 0;
        let guidance: string;
        if (focusTarget.elevationDeg <= 0) {
          guidance = state.nextPass
            ? `Below the horizon · rises ${formatTimestamp(state.nextPass.aos)}`
            : "Below the horizon · no pass in 7 days";
        } else if (aimBelowHorizon) {
          guidance = "Dish aim point is below the horizon";
        } else if ((result.guidanceOffAxisDeg ?? 180) <= 2.5) {
          guidance = "On target — hold steady";
        } else {
          const azimuthError = signedAngleDifference(guidanceTarget.azimuthDeg, view.headingDeg);
          const elevationError = guidanceTarget.elevationDeg - view.elevationDeg;
          guidance = `Turn ${Math.abs(azimuthError).toFixed(0)}° ${
            azimuthError < 0 ? "left" : "right"
          } · aim ${Math.abs(elevationError).toFixed(0)}° ${elevationError < 0 ? "down" : "up"}`;
        }
        hudGuidanceRef.current.textContent = guidance;
        hudGuidanceRef.current.dataset.state = focusTarget.elevationDeg <= 0
          ? "below"
          : (result.guidanceOffAxisDeg ?? 180) <= 2.5
            ? "locked"
            : "seeking";
      }
    }
  }, []);

  const renderFrameRef = useRef(renderFrame);
  renderFrameRef.current = renderFrame;

  useEffect(() => {
    if (!arStarted) {
      return;
    }
    let rafId = 0;
    const loop = (timestamp: number) => {
      rafId = window.requestAnimationFrame(loop);
      renderFrameRef.current(timestamp);
    };
    rafId = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(rafId);
  }, [arStarted]);

  // --- Pointer input: tap to select, drag to aim in manual mode ---------------

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX - rect.left,
      lastY: event.clientY - rect.top,
      startX: event.clientX - rect.left,
      startY: event.clientY - rect.top,
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const dx = x - drag.lastX;
    const dy = y - drag.lastY;
    drag.lastX = x;
    drag.lastY = y;
    if (Math.hypot(x - drag.startX, y - drag.startY) > 8) {
      drag.moved = true;
    }

    if (!frameStateRef.current.manualMode || !drag.moved) {
      return;
    }
    // Content follows the finger, like panning a panorama.
    const focal = frameStateRef.current.fieldOfView.focalPx;
    const current = manualViewRef.current;
    manualViewRef.current = {
      headingDeg: ((current.headingDeg - (dx / focal) / DEG) % 360 + 360) % 360,
      elevationDeg: Math.max(-88, Math.min(88, current.elevationDeg + (dy / focal) / DEG)),
      rollDeg: 0
    };
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.pointerId !== event.pointerId || drag.moved) {
      return;
    }
    // Treat it as a tap: select the closest marker under the finger.
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let best: { id: string; distance: number } | null = null;
    for (const hit of hitRegionsRef.current) {
      const distance = Math.hypot(hit.x - x, hit.y - y);
      if (distance <= hit.radius && (best === null || distance < best.distance)) {
        best = { id: hit.id, distance };
      }
    }
    if (best) {
      selectSatellite(best.id);
    }
  }

  // --- Session control -----------------------------------------------------------

  function syncFrameSize() {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    setFrameSize((current) =>
      current.width === video.videoWidth && current.height === video.videoHeight
        ? current
        : { width: video.videoWidth, height: video.videoHeight }
    );
  }

  function showToast(message: string) {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2600);
  }

  function enableManualAim() {
    // Seamless hand-off: keep looking where the sensors left the view.
    manualViewRef.current = { ...viewRef.current, rollDeg: 0 };
    filterRef.current.reset();
    ribbonHeadingFilterRef.current.reset();
    setManualMode(true);
  }

  async function startAr() {
    setArStarted(true);
    setSensorState("pending");

    // Start the iOS motion request synchronously inside the button click.
    // Awaiting getUserMedia first causes Mobile Safari to discard the user
    // activation and reject DeviceOrientationEvent.requestPermission().
    const orientationPermission = requestOrientationPermissionFromGesture();

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not expose camera access.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener("ended", () => setCameraActive(false), { once: true });
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch {
      setCameraActive(false);
    }

    try {
      const orientationResult = await orientationPermission;
      if ("error" in orientationResult) {
        throw orientationResult.error;
      }
      if (orientationResult.permission !== "granted") {
        throw new Error("Motion access was denied.");
      }

      orientationStopRef.current?.();
      sensorSampleRef.current = null;
      sensorSourceRef.current = null;
      orientationStopRef.current = startOrientationStream((quaternion, source) => {
        if (sensorSampleRef.current === null) {
          // First fix: snap straight there instead of easing in from north.
          filterRef.current.reset();
          ribbonHeadingFilterRef.current.reset();
          setSensorState("live");
          setManualMode(false);
        }
        sensorSampleRef.current = { q: quaternion, source };
        if (sensorSourceRef.current !== source) {
          sensorSourceRef.current = source;
          setSensorSource(source);
        }
      });

      if (sensorTimeoutRef.current !== null) {
        window.clearTimeout(sensorTimeoutRef.current);
      }
      sensorTimeoutRef.current = window.setTimeout(() => {
        if (sensorSampleRef.current === null) {
          setSensorState("unavailable");
          setManualMode(true);
        }
      }, 1800);
    } catch {
      setSensorState("unavailable");
      setManualMode(true);
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setFrameSize({ width: 0, height: 0 });
  }

  async function toggleReminder() {
    if (!nextPass) {
      return;
    }
    if (!reminderSet) {
      const permission = await requestNotificationPermission();
      if (!permission) {
        showToast("Allow notifications to set pass alerts");
        return;
      }
    }
    const enabled = togglePassReminder(nextPass);
    setReminderRevision((value) => value + 1);
    showToast(enabled ? "Alert set · 10 min before pass" : "Pass alert removed");
  }

  const statusText = !arStarted
    ? "Ready"
    : sensorState === "pending"
      ? "Starting…"
      : manualMode
        ? cameraActive
          ? "Camera · manual aim"
          : "Manual aim"
        : sensorState === "live"
          ? cameraActive
            ? `Live · ${sensorSource ? SOURCE_LABELS[sensorSource] : "sensors"}`
            : `Sensors only · ${sensorSource ? SOURCE_LABELS[sensorSource] : "camera off"}`
          : "Waiting for sensors…";

  const showEmptyState = arStarted && skyTargets.length === 0;

  return (
    <div className="ar-page">
      <section ref={stageRef} className="ar-stage" aria-label="Augmented reality satellite finder">
        <video
          ref={videoRef}
          className="ar-camera"
          autoPlay
          playsInline
          muted
          aria-hidden="true"
          onLoadedMetadata={syncFrameSize}
          onResize={syncFrameSize}
        />
        <div className="ar-sky-fallback" aria-hidden="true" />
        <div className="ar-vignette" aria-hidden="true" />

        <canvas
          ref={canvasRef}
          className="ar-canvas"
          style={{ width: stageSize.width, height: stageSize.height }}
          role="img"
          aria-label="Satellite positions and projected orbit paths"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
        />

        <header className="ar-topbar">
          <div className="ar-status-pill">
            <span className={`ar-live-dot ${cameraActive ? "active" : ""}`} />
            <span>{statusText}</span>
          </div>
          <div className="ar-top-actions">
            {arStarted ? (
              <button
                type="button"
                className="ar-icon-button"
                aria-label={cameraActive ? "Turn camera off" : "Retry camera"}
                onClick={cameraActive ? stopCamera : () => void startAr()}
              >
                {cameraActive ? <CameraOff size={17} /> : <Camera size={17} />}
              </button>
            ) : null}
            <button
              type="button"
              className="ar-icon-button"
              aria-label="AR settings"
              aria-expanded={showSettings}
              onClick={() => setShowSettings((open) => !open)}
            >
              <Settings2 size={18} />
            </button>
          </div>
        </header>

        {arStarted && manualMode ? (
          <div className="ar-hint-chip" aria-hidden="true">
            <Move size={13} />
            Drag to aim
          </div>
        ) : null}

        {!arStarted ? (
          <div className="ar-start">
            <div className="ar-start-icon">
              <Satellite size={28} />
            </div>
            <h1>Sky finder</h1>
            <p>
              Hold your phone up and follow the on-screen guidance to the satellites you track.
              Camera and motion sensors stay on this device.
            </p>
            <Button size="lg" onClick={() => void startAr()}>
              <LocateFixed size={17} /> Start sky finder
            </Button>
            <span className="ar-start-hint">No sensors? You can drag to look around instead.</span>
          </div>
        ) : null}

        {showEmptyState ? (
          <div className="ar-empty">
            <Satellite size={22} />
            <strong>Nothing to point at yet</strong>
            <p>Add satellites to your watchlist and they will appear in the sky here.</p>
            <Button size="sm" variant="secondary" onClick={() => setPage("catalog")}>
              Browse catalog
            </Button>
          </div>
        ) : null}

        {showSettings ? (
          <aside className="ar-settings">
            <div className="ar-settings-heading">
              <div>
                <span className="label">Pointing setup</span>
                <strong>Dish offset</strong>
              </div>
              <span className="mono">{dishOffset.toFixed(1)}°</span>
            </div>
            <Slider
              min={0}
              max={45}
              step={0.5}
              value={[dishOffset]}
              aria-label="Dish offset angle"
              onValueChange={([value]) => {
                const next = value ?? 0;
                setDishOffset(next);
                localStorage.setItem(DISH_OFFSET_KEY, String(next));
              }}
            />
            <div className="ar-offset-input">
              <label htmlFor="dish-offset">Exact offset</label>
              <input
                id="dish-offset"
                type="number"
                inputMode="decimal"
                min="0"
                max="45"
                step="0.1"
                value={dishOffset}
                onChange={(event) => {
                  const next = Math.max(0, Math.min(45, Number(event.target.value) || 0));
                  setDishOffset(next);
                  localStorage.setItem(DISH_OFFSET_KEY, String(next));
                }}
              />
            </div>
            <p>
              Satellite elevation is the signal path. Dish-face elevation subtracts the offset,
              which is the angle you physically set on an offset-fed dish.
            </p>

            <div className="ar-settings-heading">
              <div>
                <span className="label">Camera calibration</span>
                <strong>Lens field of view</strong>
              </div>
              <span className="mono">{cameraFov.toFixed(0)}°</span>
            </div>
            <Slider
              min={MIN_CAMERA_FOV_DEG}
              max={MAX_CAMERA_FOV_DEG}
              step={0.5}
              value={[cameraFov]}
              aria-label="Camera field of view"
              onValueChange={([value]) => {
                const next = value ?? DEFAULT_CAMERA_FOV_DEG;
                setCameraFov(next);
                localStorage.setItem(CAMERA_FOV_KEY, String(next));
              }}
            />
            <p>
              Measured across the long edge of the camera frame. If markers slide against the
              scene as you pan, nudge this until a marker stays pinned to the same spot.
            </p>

            <div className="ar-settings-heading">
              <div>
                <span className="label">Compass calibration</span>
                <strong>Heading trim</strong>
              </div>
              <span className="mono">
                {compassTrim > 0 ? "+" : ""}
                {compassTrim.toFixed(1)}°
              </span>
            </div>
            <div className="ar-trim-row">
              <Slider
                min={-MAX_COMPASS_TRIM_DEG}
                max={MAX_COMPASS_TRIM_DEG}
                step={0.5}
                value={[compassTrim]}
                aria-label="Compass heading trim"
                onValueChange={([value]) => {
                  const next = value ?? 0;
                  setCompassTrim(next);
                  localStorage.setItem(COMPASS_TRIM_KEY, String(next));
                }}
              />
              <button
                type="button"
                className="ar-trim-reset"
                disabled={compassTrim === 0}
                onClick={() => {
                  setCompassTrim(0);
                  localStorage.setItem(COMPASS_TRIM_KEY, "0");
                }}
              >
                Reset
              </button>
            </div>
            <p>
              Corrects a biased compass: point the camera at a landmark with a known bearing and
              trim until the overlay heading matches it.
            </p>

            <button
              type="button"
              className="ar-manual-toggle"
              disabled={manualMode && sensorState !== "live"}
              onClick={() => {
                if (manualMode) {
                  filterRef.current.reset();
                  ribbonHeadingFilterRef.current.reset();
                  setManualMode(false);
                } else {
                  enableManualAim();
                }
                setShowSettings(false);
              }}
            >
              <Crosshair size={15} />
              {manualMode
                ? sensorState === "live"
                  ? "Use device sensors"
                  : "Device sensors unavailable"
                : "Manual aim (drag to look)"}
            </button>
          </aside>
        ) : null}

        {arStarted && skyTargets.length > 0 ? (
          <div className="ar-hud">
            {toast ? (
              <div className="ar-toast" role="status" aria-live="polite">
                <BellRing size={15} />
                <span>{toast}</span>
              </div>
            ) : null}

            <div className="ar-chips" role="listbox" aria-label="Tracked satellites">
              {skyTargets.map((target) => {
                const selected = target.satellite.id === focus?.satellite.id;
                const aboveHorizon = target.snapshot.elevationDeg > 0;
                return (
                  <button
                    key={target.satellite.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`ar-chip ${selected ? "selected" : ""}`}
                    style={{ "--chip-color": target.color } as React.CSSProperties}
                    onClick={() => selectSatellite(target.satellite.id)}
                  >
                    <span className="ar-chip-dot" />
                    <span className="ar-chip-name">{target.satellite.name}</span>
                    <span className={`ar-chip-el ${aboveHorizon ? "up" : ""}`}>
                      {aboveHorizon ? "▲" : "▽"} {Math.abs(target.snapshot.elevationDeg).toFixed(0)}°
                    </span>
                  </button>
                );
              })}
            </div>

            {focus ? (
              <div className="ar-hud-card">
                <div className="ar-stats">
                  <div>
                    <span>AZ</span>
                    <strong ref={hudAzRef}>—</strong>
                  </div>
                  <div>
                    <span>EL</span>
                    <strong ref={hudElRef}>—</strong>
                  </div>
                  <div>
                    <span>RANGE</span>
                    <strong ref={hudRangeRef}>—</strong>
                  </div>
                  {dishOffset > 0 ? (
                    <div className="accent">
                      <span>DISH</span>
                      <strong ref={hudDishRef}>—</strong>
                    </div>
                  ) : null}
                </div>
                <div ref={hudGuidanceRef} className="ar-guidance" data-state="seeking">
                  Looking for {focus.satellite.name}…
                </div>
                <div className="ar-next-pass">
                  <div>
                    <span>NEXT LOOK WINDOW</span>
                    <strong>{nextPass ? formatTimestamp(nextPass.aos) : "No pass in 7 days"}</strong>
                    {nextPass ? <small>Peaks at {nextPass.maxElevationDeg.toFixed(0)}°</small> : null}
                  </div>
                  <Button
                    size="sm"
                    variant={reminderSet ? "default" : "secondary"}
                    disabled={!nextPass}
                    onClick={() => void toggleReminder()}
                  >
                    {reminderSet ? <BellRing size={15} /> : <Bell size={15} />}
                    {reminderSet ? "Alert set" : "Notify"}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
