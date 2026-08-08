/**
 * TEMPORARY field-debug instrumentation for the AR view.
 *
 * The sensor problems being chased (slow heading shift followed by a sudden
 * flip) only reproduce on a real phone, outdoors, minutes into a session —
 * they cannot be captured in DevTools. This module records the whole sensor
 * pipeline into a bounded in-memory log: raw orientation events with compass
 * accuracy, every fusion decision (anchor steps, motion/accuracy gate holds,
 * snaps), source switches, and the final rendered view. A POI button lets the
 * user stamp the exact moment something looks wrong, and the log exports as a
 * JSON file via the share sheet (or a download) for offline analysis.
 *
 * Remove this module and its call sites once the field issue is resolved.
 */

export interface ArDebugEntry {
  /** Milliseconds since page load (performance.now clock), 0.1 ms resolution. */
  t: number;
  kind: string;
  [key: string]: unknown;
}

const STORAGE_KEY = "sat-tracker-ar-debug";
const MAX_ENTRIES = 20_000;
/** Drop this many oldest entries at once when full, instead of one per push. */
const TRIM_CHUNK = 2_000;

let enabled =
  typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1";
let entries: ArDebugEntry[] = [];
let poiCount = 0;
const lastSampleAt = new Map<string, number>();

export function isArDebugEnabled() {
  return enabled;
}

export function setArDebugEnabled(next: boolean) {
  enabled = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Storage unavailable; the flag still applies for this session.
  }
  if (next) {
    arDebugLog("debug-enabled", {
      wall: new Date().toISOString(),
      ua: navigator.userAgent
    });
  }
}

export function arDebugLog(kind: string, data?: Record<string, unknown>) {
  if (!enabled) {
    return;
  }
  entries.push({ t: Math.round(performance.now() * 10) / 10, kind, ...data });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, TRIM_CHUNK);
  }
}

/**
 * Rate-limited variant for high-frequency streams (sensor events run at
 * 60 Hz); at most one entry per `kind` per `minIntervalMs`.
 */
export function arDebugSample(
  kind: string,
  minIntervalMs: number,
  data?: Record<string, unknown>
) {
  if (!enabled) {
    return;
  }
  const now = performance.now();
  const last = lastSampleAt.get(kind);
  if (last !== undefined && now - last < minIntervalMs) {
    return;
  }
  lastSampleAt.set(kind, now);
  arDebugLog(kind, data);
}

/**
 * Point of interest: a user-pressed timestamp marker ("the flip happened
 * NOW") to correlate against the surrounding sensor entries.
 */
export function arDebugPoi(note?: string) {
  poiCount += 1;
  arDebugLog("poi", {
    n: poiCount,
    wall: new Date().toISOString(),
    ...(note ? { note } : {})
  });
  return poiCount;
}

export function arDebugEntryCount() {
  return entries.length;
}

export function clearArDebugLog() {
  entries = [];
  poiCount = 0;
  lastSampleAt.clear();
}

export function buildArDebugReport() {
  return {
    exportedAt: new Date().toISOString(),
    /** Maps entry `t` values (performance.now) onto the wall clock above. */
    exportedAtPerfMs: Math.round(performance.now() * 10) / 10,
    userAgent: navigator.userAgent,
    pois: poiCount,
    settings: {
      dishOffset: localStorage.getItem("sat-tracker-dish-offset"),
      cameraFov: localStorage.getItem("sat-tracker-camera-fov"),
      compassTrim: localStorage.getItem("sat-tracker-compass-trim")
    },
    entries
  };
}

export type ArDebugExportResult = "shared" | "downloaded" | "cancelled" | "empty";

export async function exportArDebugLog(): Promise<ArDebugExportResult> {
  if (entries.length === 0) {
    return "empty";
  }
  const json = JSON.stringify(buildArDebugReport());
  const filename = `ar-debug-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

  // The share sheet is the practical route off an iPhone (AirDrop, Files,
  // mail); plain downloads land in the Files app on iOS 13+ as the fallback.
  const file = new File([json], filename, { type: "application/json" });
  if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "AR debug log" });
      return "shared";
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        return "cancelled";
      }
      // Share failed for another reason; fall through to the download path.
    }
  }

  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
