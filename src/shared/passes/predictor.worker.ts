/// <reference lib="webworker" />

import { predictPassesBulkWasm } from "@/shared/passes/predictor-bulk";
import type { PassPredictOptions } from "@/shared/passes/predictor-core";
import type { ObserverSite, SatelliteRecord } from "@/shared/types";

interface PredictRequest {
  id: number;
  records: SatelliteRecord[];
  observer: ObserverSite;
  stream?: boolean;
  options?: Omit<PassPredictOptions, "start" | "end"> & {
    start?: string;
    end?: string;
  };
}

// The bulk predictor shares a single WASM runtime, which is not safe to run
// concurrently. Chain incoming jobs so overlapping requests run one at a time.
let jobQueue: Promise<void> = Promise.resolve();
const cancelledIds = new Set<number>();

type WorkerMessage =
  | PredictRequest
  | { type: "cancel"; id: number };

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const data = event.data;

  if (data && (data as { type?: string }).type === "cancel") {
    cancelledIds.add((data as { id: number }).id);
    return;
  }

  const { id, records, observer, options, stream } = data as PredictRequest;
  jobQueue = jobQueue.then(async () => {
    if (cancelledIds.delete(id)) {
      self.postMessage({ id, type: "cancelled" });
      return;
    }
    try {
      const passes = await predictPassesBulkWasm(records, observer, {
        ...options,
        start: options?.start ? new Date(options.start) : undefined,
        end: options?.end ? new Date(options.end) : undefined
      }, stream
        ? (satellitePasses, completed, total) => {
            self.postMessage({
              id,
              type: "progress",
              passes: satellitePasses,
              completed,
              total
            });
          }
        : undefined
      );
      if (cancelledIds.delete(id)) {
        self.postMessage({ id, type: "cancelled" });
      } else {
        self.postMessage({ id, type: "complete", passes });
      }
    } catch (caught) {
      self.postMessage({
        id,
        type: "complete",
        error: caught instanceof Error ? caught.message : "Pass prediction failed."
      });
    }
  });
};
