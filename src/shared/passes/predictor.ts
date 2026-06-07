export {
  predictPassesForSatellite,
  passesToCsv,
  passesToIcs,
  type PassPredictOptions
} from "@/shared/passes/predictor-core";

import type { PassPredictOptions } from "@/shared/passes/predictor-core";
import type { ObserverSite, PassPrediction, SatelliteRecord } from "@/shared/types";

let worker: Worker | null = null;
let requestId = 0;
const pendingRequests = new Map<
  number,
  { resolve: (passes: PassPrediction[]) => void; reject: (error: Error) => void }
>();

function getWorker() {
  if (!worker && typeof Worker !== "undefined") {
    worker = new Worker(new URL("./predictor.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ id: number; passes?: PassPrediction[]; error?: string }>) => {
      const pending = pendingRequests.get(event.data.id);
      if (!pending) {
        return;
      }
      pendingRequests.delete(event.data.id);
      if (event.data.error) {
        pending.reject(new Error(event.data.error));
      } else {
        pending.resolve(event.data.passes ?? []);
      }
    };
    worker.onerror = () => {
      for (const pending of pendingRequests.values()) {
        pending.reject(new Error("Pass prediction worker failed."));
      }
      pendingRequests.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

function cacheId(records: SatelliteRecord[], observer: ObserverSite, options?: PassPredictOptions) {
  if (!options?.start || !options.end || typeof indexedDB === "undefined") {
    return null;
  }
  return JSON.stringify({
    records: records.map((record) => [record.id, record.fetchedAt]),
    observer,
    start: options.start.toISOString(),
    end: options.end.toISOString(),
    minElevationDeg: options.minElevationDeg,
    stepSeconds: options.stepSeconds
  });
}

async function readCachedPasses(id: string) {
  try {
    const { db } = await import("@/shared/db");
    const cached = await db.passCache.get(id);
    return cached && Date.now() - new Date(cached.computedAt).getTime() < 10 * 60 * 1000
      ? cached.passes
      : null;
  } catch {
    return null;
  }
}

export async function predictPassesBulk(
  records: SatelliteRecord[],
  observer: ObserverSite,
  options?: PassPredictOptions
) {
  const id = cacheId(records, observer, options);
  if (id) {
    const cachedPasses = await readCachedPasses(id);
    if (cachedPasses) {
      return cachedPasses;
    }
  }

  let passes: PassPrediction[];
  const predictionWorker = getWorker();
  if (predictionWorker) {
    passes = await new Promise<PassPrediction[]>((resolve, reject) => {
      const nextRequestId = requestId++;
      pendingRequests.set(nextRequestId, { resolve, reject });
      predictionWorker.postMessage({
        id: nextRequestId,
        records,
        observer,
        options: {
          ...options,
          start: options?.start?.toISOString(),
          end: options?.end?.toISOString()
        }
      });
    });
  } else {
    const { predictPassesBulkWasm } = await import("@/shared/passes/predictor-bulk");
    passes = await predictPassesBulkWasm(records, observer, options);
  }

  if (id && options?.start && options.end) {
    try {
      const { db } = await import("@/shared/db");
      await db.passCache.put({
        id,
        observerId: observer.id,
        satelliteId: records.map((record) => record.id).join(","),
        windowStart: options.start.toISOString(),
        windowEnd: options.end.toISOString(),
        computedAt: new Date().toISOString(),
        passes
      });
    } catch {
      // Cache failures should not hide successful predictions.
    }
  }

  return passes;
}
