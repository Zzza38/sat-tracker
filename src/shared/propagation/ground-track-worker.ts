import { buildGroundTrack } from "@/shared/propagation/engine";
import type { GroundTrackPoint, SatelliteRecord } from "@/shared/types";

interface GroundTrackRequest {
  id: number;
  records: SatelliteRecord[];
  start: string;
  points: number;
  stepSeconds: number;
}

interface GroundTrackResponse {
  id: number;
  tracks?: Record<string, GroundTrackPoint[]>;
  error?: string;
}

let worker: Worker | null = null;
let workerDisabled = false;
let requestId = 0;
const pendingRequests = new Map<
  number,
  {
    resolve: (tracks: Map<string, GroundTrackPoint[]>) => void;
    reject: (error: Error) => void;
  }
>();

function getWorker() {
  if (workerDisabled || typeof Worker === "undefined") {
    return null;
  }

  if (!worker) {
    try {
      worker = new Worker(new URL("./ground-track.worker.ts", import.meta.url), { type: "module" });
    } catch {
      workerDisabled = true;
      return null;
    }

    worker.onmessage = (event: MessageEvent<GroundTrackResponse>) => {
      const pending = pendingRequests.get(event.data.id);
      if (!pending) {
        return;
      }
      pendingRequests.delete(event.data.id);

      if (event.data.error) {
        pending.reject(new Error(event.data.error));
        return;
      }

      pending.resolve(new Map(Object.entries(event.data.tracks ?? {})));
    };

    worker.onerror = () => {
      workerDisabled = true;
      worker?.terminate();
      worker = null;
      for (const [, pending] of pendingRequests) {
        pending.reject(new Error("Ground track worker failed."));
      }
      pendingRequests.clear();
    };
  }

  return worker;
}

function buildOnMainThread(
  records: SatelliteRecord[],
  start: Date,
  points: number,
  stepSeconds: number
) {
  const tracks = new Map<string, GroundTrackPoint[]>();
  for (const record of records) {
    try {
      tracks.set(record.id, buildGroundTrack(record, start, points, stepSeconds));
    } catch {
      tracks.set(record.id, []);
    }
  }
  return tracks;
}

export function cancelGroundTrackBuild(id: number) {
  const pending = pendingRequests.get(id);
  if (!pending) {
    return;
  }
  pendingRequests.delete(id);
  pending.reject(new Error("Ground track build cancelled."));
}

/** Build ground tracks off the main thread when a worker is available. */
export function buildGroundTracksAsync(
  records: SatelliteRecord[],
  start: Date,
  points: number,
  stepSeconds: number
): { id: number; promise: Promise<Map<string, GroundTrackPoint[]>> } {
  const id = ++requestId;
  const activeWorker = getWorker();

  if (!activeWorker) {
    return {
      id,
      promise: Promise.resolve(buildOnMainThread(records, start, points, stepSeconds))
    };
  }

  const promise = new Promise<Map<string, GroundTrackPoint[]>>((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    const payload: GroundTrackRequest = {
      id,
      records,
      start: start.toISOString(),
      points,
      stepSeconds
    };
    activeWorker.postMessage(payload);
  });

  return { id, promise };
}
