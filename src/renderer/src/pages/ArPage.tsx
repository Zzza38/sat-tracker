import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  BellRing,
  Camera,
  CameraOff,
  Crosshair,
  LocateFixed,
  Orbit,
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
  DEFAULT_CAMERA_FOV_DEG,
  MAX_CAMERA_FOV_DEG,
  MIN_CAMERA_FOV_DEG,
  directionFromOrientation,
  dishFaceElevation,
  interpolateViewDirection,
  orientationSmoothingFactor,
  projectLookAngle,
  selectNextLookPass,
  shouldAcceptOrientationSource,
  signedAngleDifference,
  stageFieldOfView,
  type FieldOfView,
  type OrientationSource,
  type ViewDirection
} from "../lib/ar";
import {
  hasPassReminder,
  REMINDERS_CHANGED_EVENT,
  togglePassReminder
} from "../lib/passReminders";
import { requestNotificationPermission } from "../lib/platform";

const DISH_OFFSET_KEY = "sat-tracker-dish-offset";
const CAMERA_FOV_KEY = "sat-tracker-camera-fov";
const MAX_AR_SATELLITES = 12;
const ORBIT_POINTS = 46;
const ORBIT_STEP_SECONDS = 60;
/** Pass-window quantisation, so the cached prediction is reusable between runs. */
const PASS_WINDOW_BUCKET_MS = 5 * 60_000;

interface DeviceOrientationWithCompass extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

interface DeviceOrientationPermission {
  requestPermission?: () => Promise<"granted" | "denied">;
}

type OrientationPermissionResult =
  | { permission: "granted" | "denied" }
  | { error: unknown };

interface SkyTarget {
  satellite: SatelliteRecord;
  snapshot: OrbitSnapshot;
  color: string;
  orbit: OrbitSnapshot[];
}

function readDishOffset() {
  const stored = Number(localStorage.getItem(DISH_OFFSET_KEY));
  return Number.isFinite(stored) ? Math.max(0, Math.min(45, stored)) : 0;
}

function readCameraFov() {
  const raw = localStorage.getItem(CAMERA_FOV_KEY);
  const stored = Number(raw);
  if (raw === null || !Number.isFinite(stored) || stored <= 0) {
    return DEFAULT_CAMERA_FOV_DEG;
  }
  return Math.max(MIN_CAMERA_FOV_DEG, Math.min(MAX_CAMERA_FOV_DEG, stored));
}

/**
 * Landscape rotates the screen axes away from the device axes, so the overlay
 * needs the current angle to stay square with the camera frame.
 */
function readScreenAngle() {
  const angle = window.screen?.orientation?.angle;
  if (typeof angle === "number") {
    return angle;
  }
  const legacy = (window as { orientation?: number }).orientation;
  return typeof legacy === "number" ? normalizeScreenAngle(legacy) : 0;
}

function normalizeScreenAngle(value: number) {
  return ((value % 360) + 360) % 360;
}

function safeSnapshot(satellite: SatelliteRecord, date: Date, observer: ReturnType<typeof useApp>["observer"]) {
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

function orbitSegments(
  orbit: OrbitSnapshot[],
  view: ViewDirection,
  width: number,
  height: number,
  fov: FieldOfView
) {
  const segments: string[][] = [];
  let segment: string[] = [];

  for (const point of orbit) {
    const projected = projectLookAngle(
      point.azimuthDeg,
      point.elevationDeg,
      view,
      width,
      height,
      fov
    );
    const withinMargin =
      !projected.behind &&
      projected.x >= -width * 0.12 &&
      projected.x <= width * 1.12 &&
      projected.y >= -height * 0.12 &&
      projected.y <= height * 1.12 &&
      point.elevationDeg >= -5;

    if (withinMargin) {
      segment.push(`${projected.x.toFixed(1)},${projected.y.toFixed(1)}`);
    } else if (segment.length > 1) {
      segments.push(segment);
      segment = [];
    } else {
      segment = [];
    }
  }

  if (segment.length > 1) {
    segments.push(segment);
  }
  return segments;
}

export function ArPage() {
  const {
    satellites,
    watchlistIds,
    selectedSatellite,
    selectedSatelliteId,
    observer,
    selectSatellite,
    getSatelliteColor
  } = useApp();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const orientationCleanupRef = useRef<(() => void) | null>(null);
  const orientationSourceRef = useRef<OrientationSource | null>(null);
  const lastAbsoluteOrientationAtRef = useRef(0);
  const orientationTargetRef = useRef<ViewDirection>({ headingDeg: 0, elevationDeg: 0 });
  const orientationFrameRef = useRef<number | null>(null);
  const orientationFrameTimeRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const viewRef = useRef<ViewDirection>({ headingDeg: 0, elevationDeg: 0, rollDeg: 0 });
  const hasFixRef = useRef(false);
  const liveNow = useTicker(1000);
  const [cameraActive, setCameraActive] = useState(false);
  const [arStarted, setArStarted] = useState(false);
  const [sensorActive, setSensorActive] = useState(false);
  const [status, setStatus] = useState("Ready for camera and motion access");
  const [view, setView] = useState<ViewDirection>({ headingDeg: 0, elevationDeg: 0 });
  const [manualView, setManualView] = useState(false);
  const [dishOffset, setDishOffset] = useState(readDishOffset);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState({ width: 390, height: 700 });
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [cameraFov, setCameraFov] = useState(readCameraFov);
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
    const recordsById = new Map(satellites.map((satellite) => [satellite.id, satellite]));
    const watched = watchlistIds.flatMap((id) => {
      const satellite = recordsById.get(id);
      return satellite ? [satellite] : [];
    });
    return (watched.length > 0 ? watched : selectedSatellite ? [selectedSatellite] : [])
      .slice(0, MAX_AR_SATELLITES);
  }, [satellites, selectedSatellite, watchlistIds]);
  const visibleIds = useMemo(
    () => visibleSatellites.map((satellite) => satellite.id),
    [visibleSatellites]
  );
  const orbitTimeKey = Math.floor(liveNow.getTime() / 30_000);
  const skyTargets = useMemo<SkyTarget[]>(() => {
    const now = new Date();
    return visibleSatellites.flatMap((satellite) => {
      const snapshot = safeSnapshot(satellite, now, observer);
      if (!snapshot) {
        return [];
      }
      const orbit = Array.from({ length: ORBIT_POINTS }, (_, index) =>
        safeSnapshot(
          satellite,
          new Date(now.getTime() + index * ORBIT_STEP_SECONDS * 1000),
          observer
        )
      ).filter((point): point is OrbitSnapshot => point !== null);
      return [{
        satellite,
        snapshot,
        orbit,
        color: getSatelliteColor(satellite.id, visibleIds)
      }];
    });
  }, [getSatelliteColor, observer, orbitTimeKey, visibleIds, visibleSatellites]);
  const focus = skyTargets.find((target) => target.satellite.id === selectedSatelliteId) ?? skyTargets[0];

  // A seven-day scan is ~20k propagations. Run it on the shared prediction
  // worker instead of the render thread, and quantise the window so repeat
  // runs hit the prediction cache rather than recomputing every tick.
  // Selection of the still-active "next" pass is separate: the worker only
  // refreshes on the five-minute bucket, but after a pass's LOS we must drop
  // it from the readout without waiting for that bucket to roll.
  const passWindowStart = Math.floor(liveNow.getTime() / PASS_WINDOW_BUCKET_MS) * PASS_WINDOW_BUCKET_MS;
  const [predictedPasses, setPredictedPasses] = useState<PassPrediction[]>([]);
  const focusSatellite = focus?.satellite;

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

  const nextPass = useMemo(() => {
    const nowIso = new Date(orbitTimeKey * 30_000).toISOString();
    return selectNextLookPass(predictedPasses, nowIso);
  }, [orbitTimeKey, predictedPasses]);

  const reminderSet = nextPass ? hasPassReminder(nextPass) : false;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setStageSize({
          width: Math.max(1, entry.contentRect.width),
          height: Math.max(1, entry.contentRect.height)
        });
      }
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const refresh = () => setReminderRevision((value) => value + 1);
    window.addEventListener(REMINDERS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(REMINDERS_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      orientationCleanupRef.current?.();
      if (orientationFrameRef.current !== null) {
        window.cancelAnimationFrame(orientationFrameRef.current);
      }
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  function applyView(next: ViewDirection) {
    viewRef.current = next;
    setView(next);
  }

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

  async function startAr() {
    setArStarted(true);
    setStatus("Requesting camera and motion access...");
    let cameraStarted = false;

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
      cameraStarted = true;
      setCameraActive(true);
    } catch (error) {
      setCameraActive(false);
      setStatus(error instanceof Error ? error.message : "Camera access failed.");
    }

    try {
      const orientationResult = await orientationPermission;
      if ("error" in orientationResult) {
        throw orientationResult.error;
      }
      if (orientationResult.permission !== "granted") {
        throw new Error("Motion access was denied.");
      }

      orientationSourceRef.current = null;
      lastAbsoluteOrientationAtRef.current = 0;
      orientationFrameTimeRef.current = null;
      hasFixRef.current = false;
      if (orientationFrameRef.current !== null) {
        window.cancelAnimationFrame(orientationFrameRef.current);
        orientationFrameRef.current = null;
      }

      const animateOrientation = (timestamp: number) => {
        const previousTimestamp = orientationFrameTimeRef.current ?? timestamp;
        orientationFrameTimeRef.current = timestamp;
        const factor = orientationSmoothingFactor(timestamp - previousTimestamp);
        const next = interpolateViewDirection(
          viewRef.current,
          orientationTargetRef.current,
          factor
        );

        if (next === viewRef.current) {
          // Caught up with the sensor. Park the loop rather than re-rendering
          // every frame with an unchanged view; the next event restarts it.
          orientationFrameRef.current = null;
          orientationFrameTimeRef.current = null;
          return;
        }

        viewRef.current = next;
        setView(next);
        orientationFrameRef.current = window.requestAnimationFrame(animateOrientation);
      };

      const handleOrientation = (
        event: DeviceOrientationEvent,
        eventSource: "absolute" | "relative"
      ) => {
        const compassEvent = event as DeviceOrientationWithCompass;
        const source =
          eventSource === "absolute" || event.absolute || compassEvent.webkitCompassHeading !== undefined
            ? "absolute"
            : "relative";

        const now = performance.now();
        if (!shouldAcceptOrientationSource(
          orientationSourceRef.current,
          source,
          now - lastAbsoluteOrientationAtRef.current
        )) {
          return;
        }

        const direction = directionFromOrientation({
          alpha: event.alpha,
          beta: event.beta,
          gamma: event.gamma,
          compassHeading: compassEvent.webkitCompassHeading,
          screenAngleDeg: readScreenAngle()
        });
        if (direction) {
          if (source === "absolute") {
            lastAbsoluteOrientationAtRef.current = now;
          }
          orientationSourceRef.current = source;
          orientationTargetRef.current = direction;
          if (!hasFixRef.current) {
            // First reading: jump straight there instead of easing in from north.
            hasFixRef.current = true;
            viewRef.current = direction;
            setView(direction);
          }
          if (orientationFrameRef.current === null) {
            orientationFrameTimeRef.current = null;
            orientationFrameRef.current = window.requestAnimationFrame(animateOrientation);
          }
          setSensorActive(true);
          setManualView(false);
          setStatus(cameraStarted ? "Live camera and orientation" : "Orientation live · camera unavailable");
        }
      };
      const handleAbsoluteOrientation = (event: DeviceOrientationEvent) =>
        handleOrientation(event, "absolute");
      const handleRelativeOrientation = (event: DeviceOrientationEvent) =>
        handleOrientation(event, "relative");
      orientationCleanupRef.current?.();
      window.addEventListener(
        "deviceorientationabsolute",
        handleAbsoluteOrientation as EventListener,
        true
      );
      window.addEventListener("deviceorientation", handleRelativeOrientation, true);
      orientationCleanupRef.current = () => {
        window.removeEventListener(
          "deviceorientationabsolute",
          handleAbsoluteOrientation as EventListener,
          true
        );
        window.removeEventListener("deviceorientation", handleRelativeOrientation, true);
        if (orientationFrameRef.current !== null) {
          window.cancelAnimationFrame(orientationFrameRef.current);
          orientationFrameRef.current = null;
        }
      };
      window.setTimeout(() => {
        setSensorActive((active) => {
          if (!active) {
            setManualView(true);
            setStatus(
              cameraStarted
                ? "Camera live · orientation unavailable, use manual aim"
                : "Camera unavailable · use manual aim"
            );
          }
          return active;
        });
      }, 1800);
    } catch (error) {
      setManualView(true);
      setStatus(error instanceof Error ? `${error.message} Use manual aim.` : "Use manual aim.");
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
    setStatus(sensorActive ? "Orientation live · camera off" : "AR paused");
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

  const focusDishElevation = focus
    ? dishFaceElevation(focus.snapshot.elevationDeg, dishOffset)
    : 0;
  const azimuthError = focus ? signedAngleDifference(focus.snapshot.azimuthDeg, view.headingDeg) : 0;
  const elevationError = focus ? focusDishElevation - view.elevationDeg : 0;

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

        <header className="ar-topbar">
          <div>
            <span className={`ar-live-dot ${cameraActive ? "active" : ""}`} />
            <span>{status}</span>
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

        <div className="ar-compass" aria-hidden="true">
          <span>{Math.round(view.headingDeg).toString().padStart(3, "0")}°</span>
          <strong>
            {["N", "NE", "E", "SE", "S", "SW", "W", "NW"][
              Math.round(view.headingDeg / 45) % 8
            ]}
          </strong>
        </div>

        <svg
          className="ar-overlay"
          viewBox={`0 0 ${stageSize.width} ${stageSize.height}`}
          role="img"
          aria-label="Satellite positions and projected orbit paths"
        >
          <defs>
            <filter id="ar-glow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <line
            x1={stageSize.width / 2 - 18}
            y1={stageSize.height / 2}
            x2={stageSize.width / 2 + 18}
            y2={stageSize.height / 2}
            className="ar-reticle"
          />
          <line
            x1={stageSize.width / 2}
            y1={stageSize.height / 2 - 18}
            x2={stageSize.width / 2}
            y2={stageSize.height / 2 + 18}
            className="ar-reticle"
          />
          {skyTargets.flatMap((target) =>
            orbitSegments(
              target.orbit,
              view,
              stageSize.width,
              stageSize.height,
              fieldOfView
            ).map((points, index) => (
              <polyline
                key={`${target.satellite.id}-orbit-${index}`}
                points={points.join(" ")}
                fill="none"
                stroke={target.color}
                strokeWidth={target.satellite.id === focus?.satellite.id ? 2 : 1}
                strokeDasharray="4 7"
                opacity={target.satellite.id === focus?.satellite.id ? 0.85 : 0.35}
              />
            ))
          )}
          {skyTargets.map((target) => {
            const position = projectLookAngle(
              target.snapshot.azimuthDeg,
              target.snapshot.elevationDeg,
              view,
              stageSize.width,
              stageSize.height,
              fieldOfView
            );
            if (!position.visible) {
              return null;
            }
            const selected = target.satellite.id === focus?.satellite.id;
            return (
              <g
                key={target.satellite.id}
                transform={`translate(${position.x} ${position.y})`}
                className="ar-target"
                onClick={() => selectSatellite(target.satellite.id)}
                role="button"
                aria-label={`Select ${target.satellite.name}`}
              >
                <circle r={selected ? 19 : 11} fill="rgba(4,8,13,.62)" stroke={target.color} strokeWidth={selected ? 2 : 1} />
                <circle r={selected ? 4 : 3} fill={target.color} filter="url(#ar-glow)" />
                <text y={selected ? -28 : -19} textAnchor="middle" className="ar-target-name">
                  {target.satellite.name}
                </text>
                <text y={selected ? 34 : 27} textAnchor="middle" className="ar-target-angle">
                  {target.snapshot.azimuthDeg.toFixed(0)}° / {target.snapshot.elevationDeg.toFixed(0)}°
                </text>
              </g>
            );
          })}
          {focus && dishOffset > 0 ? (() => {
            const dishPosition = projectLookAngle(
              focus.snapshot.azimuthDeg,
              focusDishElevation,
              view,
              stageSize.width,
              stageSize.height,
              fieldOfView
            );
            if (!dishPosition.visible) {
              return null;
            }
            return (
              <g transform={`translate(${dishPosition.x} ${dishPosition.y})`} className="ar-dish-target">
                <circle r="24" />
                <path d="M -31 0 H -15 M 15 0 H 31 M 0 -31 V -15 M 0 15 V 31" />
                <text y="43" textAnchor="middle">DISH FACE</text>
              </g>
            );
          })() : null}
        </svg>

        {focus && focusDishElevation >= 0 && !projectLookAngle(
          focus.snapshot.azimuthDeg,
          dishOffset > 0 ? focusDishElevation : focus.snapshot.elevationDeg,
          view,
          stageSize.width,
          stageSize.height,
          fieldOfView
        ).visible ? (
          <div
            className="ar-offscreen-cue"
            style={{
              // Screen space, so the arrow has to unwind the device roll.
              transform: `translateX(-50%) rotate(${
                (Math.atan2(azimuthError, elevationError) * 180) / Math.PI - (view.rollDeg ?? 0)
              }deg)`
            }}
          >
            ↑
          </div>
        ) : null}

        {!arStarted ? (
          <div className="ar-start">
            <div className="ar-start-icon"><Camera size={28} /></div>
            <h1>Point at the sky</h1>
            <p>Uses your camera and motion sensors. No native AR framework, no account, no mysterious cloud ritual.</p>
            <Button size="lg" onClick={() => void startAr()}>
              <LocateFixed size={17} /> Start AR finder
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
              Satellite elevation is the signal path. Dish-face elevation subtracts the offset, which is the angle you physically set on an offset-fed dish.
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
              Measured across the long edge of the camera frame. If markers slide against the scene as you pan, nudge this until a marker stays pinned to the same spot in the room.
            </p>
            <button
              type="button"
              className="ar-manual-toggle"
              disabled={manualView && !sensorActive}
              onClick={() => {
                setManualView((active) => !active);
                setShowSettings(false);
              }}
            >
              <Crosshair size={15} />
              {manualView
                ? sensorActive
                  ? "Use device sensors"
                  : "Device sensors unavailable"
                : "Manual aim / calibration"}
            </button>
          </aside>
        ) : null}

        {manualView ? (
          <div className="ar-manual-controls">
            <label>
              <span>Heading</span>
              <input
                type="range"
                min="0"
                max="359"
                value={view.headingDeg}
                onChange={(event) => applyView({ ...viewRef.current, headingDeg: Number(event.target.value) })}
              />
            </label>
            <label>
              <span>Elevation</span>
              <input
                type="range"
                min="-90"
                max="90"
                value={view.elevationDeg}
                onChange={(event) => applyView({ ...viewRef.current, elevationDeg: Number(event.target.value) })}
              />
            </label>
          </div>
        ) : null}

        {arStarted ? (
          <div className="ar-readout">
            {toast ? (
              <div className="ar-toast" role="status" aria-live="polite">
                <BellRing size={15} />
                <span>{toast}</span>
              </div>
            ) : null}
            <div className="ar-selected">
              <span className="ar-selected-icon" style={{ color: focus?.color }}>
                <Orbit size={19} />
              </span>
              <div>
                <span>TRACKING</span>
                {focus && skyTargets.length > 1 ? (
                  <select
                    className="ar-satellite-select"
                    value={focus.satellite.id}
                    aria-label="Tracked satellite"
                    onChange={(event) => selectSatellite(event.target.value)}
                  >
                    {skyTargets.map((target) => (
                      <option key={target.satellite.id} value={target.satellite.id}>
                        {target.satellite.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <strong>{focus?.satellite.name ?? "No satellite selected"}</strong>
                )}
              </div>
            </div>
            {focus ? (
              <>
                <div className="ar-angles">
                  <div><span>AZ</span><strong>{focus.snapshot.azimuthDeg.toFixed(1)}°</strong></div>
                  <div><span>SAT EL</span><strong>{focus.snapshot.elevationDeg.toFixed(1)}°</strong></div>
                  <div className={dishOffset > 0 ? "accent" : ""}>
                    <span>DISH FACE</span><strong>{focusDishElevation.toFixed(1)}°</strong>
                  </div>
                </div>
                {focus.snapshot.elevationDeg > 0 ? (
                  <div className="ar-guidance">
                    Turn {Math.abs(azimuthError).toFixed(1)}° {azimuthError < 0 ? "left" : "right"}
                    <span>·</span>
                    Aim {Math.abs(elevationError).toFixed(1)}° {elevationError < 0 ? "down" : "up"}
                  </div>
                ) : (
                  <div className="ar-guidance below-horizon">
                    Below the horizon · wait for the next look window
                  </div>
                )}
              </>
            ) : null}
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
      </section>
    </div>
  );
}
