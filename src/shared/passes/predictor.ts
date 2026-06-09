export {
  predictPassesForSatellite,
  passesToCsv,
  passesToIcs,
  type PassPredictOptions
} from "@/shared/passes/predictor-core";

import { predictPassesForSatellite, type PassPredictOptions } from "@/shared/passes/predictor-core";
import type { ObserverSite, PassPrediction, SatelliteRecord } from "@/shared/types";

interface PassPredictionProgress {
  passes: PassPrediction[];
  completed: number;
  total: number;
}

let worker: Worker | null = null;
let workerDisabled = false;
let requestId = 0;
const pendingRequests = new Map<
  number,
  {
    resolve: (passes: PassPrediction[]) => void;
    reject: (error: Error) => void;
    onProgress?: (progress: PassPredictionProgress) => void;
  }
>();

function getWorker() {
  if (workerDisabled || typeof Worker === "undefined") {
    return null;
  }

  if (!worker) {
    try {
      worker = new Worker(new URL("./predictor.worker.ts", import.meta.url), { type: "module" });
    } catch {
      workerDisabled = true;
      return null;
    }

    worker.onmessage = (event: MessageEvent<{
      id: number;
      type?: "progress" | "complete";
      passes?: PassPrediction[];
      error?: string;
      completed?: number;
      total?: number;
    }>) => {
      const pending = pendingRequests.get(event.data.id);
      if (!pending) {
        return;
      }

      if (event.data.type === "progress") {
        pending.onProgress?.({
          passes: event.data.passes ?? [],
          completed: event.data.completed ?? 0,
          total: event.data.total ?? 0
        });
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
      workerDisabled = true;
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

async function predictWithoutWorker(
  records: SatelliteRecord[],
  observer: ObserverSite,
  options?: PassPredictOptions
) {
  try {
    const { predictPassesBulkWasm } = await import("@/shared/passes/predictor-bulk");
    return await predictPassesBulkWasm(records, observer, options);
  } catch {
    return records
      .flatMap((record) => predictPassesForSatellite(record, observer, options))
      .sort((left, right) => left.aos.localeCompare(right.aos));
  }
}

async function predictWithoutWorkerStreaming(
  records: SatelliteRecord[],
  observer: ObserverSite,
  options: PassPredictOptions | undefined,
  onProgress: (progress: PassPredictionProgress) => void
) {
  try {
    const { predictPassesBulkWasm } = await import("@/shared/passes/predictor-bulk");
    return await predictPassesBulkWasm(records, observer, options, (passes, completed, total) => {
      onProgress({ passes, completed, total });
    });
  } catch {
    const allPasses: PassPrediction[] = [];
    records.forEach((record, index) => {
      const passes = predictPassesForSatellite(record, observer, options);
      allPasses.push(...passes);
      onProgress({
        passes,
        completed: index + 1,
        total: records.length
      });
    });

    return allPasses.sort((left, right) => left.aos.localeCompare(right.aos));
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
    try {
      passes = await new Promise<PassPrediction[]>((resolve, reject) => {
        const nextRequestId = requestId++;
        pendingRequests.set(nextRequestId, { resolve, reject });
        try {
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
        } catch (caught) {
          pendingRequests.delete(nextRequestId);
          reject(caught instanceof Error ? caught : new Error("Pass prediction worker failed."));
        }
      });
    } catch {
      worker?.terminate();
      worker = null;
      workerDisabled = true;
      passes = await predictWithoutWorker(records, observer, options);
    }
  } else {
    passes = await predictWithoutWorker(records, observer, options);
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

export async function predictPassesBulkStreaming(
  records: SatelliteRecord[],
  observer: ObserverSite,
  options: PassPredictOptions | undefined,
  onProgress: (progress: PassPredictionProgress) => void
) {
  const id = cacheId(records, observer, options);
  if (id) {
    const cachedPasses = await readCachedPasses(id);
    if (cachedPasses) {
      const passesBySatellite = new Map<string, PassPrediction[]>();
      cachedPasses.forEach((pass) => {
        passesBySatellite.set(pass.satelliteId, [
          ...(passesBySatellite.get(pass.satelliteId) ?? []),
          pass
        ]);
      });
      records.forEach((record, index) => {
        onProgress({
          passes: passesBySatellite.get(record.id) ?? [],
          completed: index + 1,
          total: records.length
        });
      });
      return cachedPasses;
    }
  }

  let passes: PassPrediction[];
  const predictionWorker = getWorker();
  if (predictionWorker) {
    try {
      passes = await new Promise<PassPrediction[]>((resolve, reject) => {
        const nextRequestId = requestId++;
        pendingRequests.set(nextRequestId, { resolve, reject, onProgress });
        try {
          predictionWorker.postMessage({
            id: nextRequestId,
            records,
            observer,
            stream: true,
            options: {
              ...options,
              start: options?.start?.toISOString(),
              end: options?.end?.toISOString()
            }
          });
        } catch (caught) {
          pendingRequests.delete(nextRequestId);
          reject(caught instanceof Error ? caught : new Error("Pass prediction worker failed."));
        }
      });
    } catch {
      worker?.terminate();
      worker = null;
      workerDisabled = true;
      passes = await predictWithoutWorkerStreaming(records, observer, options, onProgress);
    }
  } else {
    passes = await predictWithoutWorkerStreaming(records, observer, options, onProgress);
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
