import { fetchCelestrakSatellite, fetchTleSource, refreshSatelliteRecord } from "@/shared/celestrak/client";
import { db } from "@/shared/db";
import { createSatelliteRecord, parseElementInput } from "@/shared/tle/parser";
import { SatelliteRecord, TleSource } from "@/shared/types";

export async function listSatellites() {
  return db.satellites.orderBy("name").toArray();
}

export async function getSatellite(id: string) {
  return db.satellites.get(id);
}

export async function upsertSatellite(record: SatelliteRecord) {
  await db.satellites.put(record);
  return record;
}

export async function addManualElements(raw: string) {
  const parsed = parseElementInput(raw);
  const record = createSatelliteRecord(parsed, "manual");
  return upsertSatellite(record);
}

export async function addFromNoradId(noradId: string) {
  const record = await fetchCelestrakSatellite(noradId);
  return upsertSatellite(record);
}

export async function refreshSatellite(id: string) {
  const existing = await db.satellites.get(id);
  if (!existing) {
    throw new Error("Satellite not found.");
  }

  const refreshed = await refreshSatelliteRecord(existing);
  return upsertSatellite(refreshed);
}

export async function importFromTleSource(source: TleSource) {
  const records = await fetchTleSource(source);
  await db.satellites.bulkPut(records);
  return records.length;
}

export async function removeSatellite(id: string) {
  await db.satellites.delete(id);
}

export async function toggleWatchlistSatellite(watchlistId: string, satelliteId: string) {
  const watchlist = await db.watchlists.get(watchlistId);
  if (!watchlist) {
    throw new Error("Watchlist not found.");
  }

  const exists = watchlist.satelliteIds.includes(satelliteId);
  const satelliteIds = exists
    ? watchlist.satelliteIds.filter((id) => id !== satelliteId)
    : [...watchlist.satelliteIds, satelliteId];

  await db.watchlists.update(watchlistId, { satelliteIds });
  return satelliteIds;
}

export async function getWatchlistSatellites(watchlistId = "default") {
  const watchlist = await db.watchlists.get(watchlistId);
  if (!watchlist) {
    return [];
  }

  return db.satellites.where("id").anyOf(watchlist.satelliteIds).toArray();
}
