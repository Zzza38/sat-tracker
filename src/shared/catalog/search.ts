import { SatelliteRecord } from "@/shared/types";

export function searchSatellites(records: SatelliteRecord[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return records;
  }

  return records.filter((record) => {
    return (
      record.name.toLowerCase().includes(normalized) ||
      record.noradId.includes(normalized) ||
      record.internationalDesignator?.toLowerCase().includes(normalized)
    );
  });
}

export function sortSatellites(records: SatelliteRecord[], trackedIds: string[] = []) {
  const tracked = new Set(trackedIds);
  return [...records].sort((left, right) => {
    const leftTracked = tracked.has(left.id);
    const rightTracked = tracked.has(right.id);
    if (leftTracked !== rightTracked) {
      return leftTracked ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
}
