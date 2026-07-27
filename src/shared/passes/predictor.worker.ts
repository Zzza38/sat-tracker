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
// Only the most recently enqueued request is worth running; anything older is
// superseded and is dropped at the head of the queue so a stale drag/commit
// doesn't burn a full WASM propagation.
let latestId = -1;

type WorkerMessage =
  | PredictRequest
  | { type: "cancel"; id: number };

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const data = event.data;

  if (data && (data as { type?: string }).type === "cancel") {
    // A cancelled id is no longer the latest, so the guard below skips it.
    return;
  }

  const { id, records, observer, options, stream } = data as PredictRequest;
  latestId = id;
  jobQueue = jobQueue.then(async () => {
    if (id !== latestId) {
      self.postMessage({ id, type: "complete", passes: [] });
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
      self.postMessage({ id, type: "complete", passes });
    } catch (caught) {
      self.postMessage({
        id,
        type: "complete",
        error: caught instanceof Error ? caught.message : "Pass prediction failed."
      });
    }
  });
};
