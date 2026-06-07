/// <reference lib="webworker" />

import { predictPassesBulkWasm } from "@/shared/passes/predictor-bulk";
import type { PassPredictOptions } from "@/shared/passes/predictor-core";
import type { ObserverSite, SatelliteRecord } from "@/shared/types";

interface PredictRequest {
  id: number;
  records: SatelliteRecord[];
  observer: ObserverSite;
  options?: Omit<PassPredictOptions, "start" | "end"> & {
    start?: string;
    end?: string;
  };
}

self.onmessage = async (event: MessageEvent<PredictRequest>) => {
  const { id, records, observer, options } = event.data;
  try {
    const passes = await predictPassesBulkWasm(records, observer, {
      ...options,
      start: options?.start ? new Date(options.start) : undefined,
      end: options?.end ? new Date(options.end) : undefined
    });
    self.postMessage({ id, passes });
  } catch (caught) {
    self.postMessage({
      id,
      error: caught instanceof Error ? caught.message : "Pass prediction failed."
    });
  }
};
