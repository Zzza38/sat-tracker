/// <reference lib="webworker" />

import { buildGroundTrack } from "@/shared/propagation/engine";
import type { GroundTrackPoint, SatelliteRecord } from "@/shared/types";

interface GroundTrackRequest {
  id: number;
  records: SatelliteRecord[];
  start: string;
  points: number;
  stepSeconds: number;
}

let latestId = -1;

self.onmessage = (event: MessageEvent<GroundTrackRequest>) => {
  const { id, records, start, points, stepSeconds } = event.data;
  latestId = id;

  try {
    if (id !== latestId) {
      self.postMessage({ id, tracks: {} });
      return;
    }

    const startDate = new Date(start);
    const tracks: Record<string, GroundTrackPoint[]> = {};
    for (const record of records) {
      if (id !== latestId) {
        self.postMessage({ id, tracks: {} });
        return;
      }
      try {
        tracks[record.id] = buildGroundTrack(record, startDate, points, stepSeconds);
      } catch {
        tracks[record.id] = [];
      }
    }

    self.postMessage({ id, tracks });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : "Ground track build failed."
    });
  }
};
