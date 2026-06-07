import { fetchCelestrakSatellite, iterateTleSource, refreshSatelliteRecord } from "@/shared/celestrak/client";
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

function normalizeNoradId(raw: string) {
  const value = raw.trim();
  if (!/^\d{1,9}$/.test(value) || Number(value) <= 0 || Number(value) > 999_999_999) {
    throw new Error("NORAD ID must be a positive number with at most 9 digits.");
  }
  return value;
}

export function parseNoradIds(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,;]+/)
        .map((part) => part.trim())
        .filter((part) => {
          if (!/^\d{1,9}$/.test(part)) {
            return false;
          }
          const value = Number(part);
          return Number.isSafeInteger(value) && value > 0 && value <= 999_999_999;
        })
    )
  ];
}

export async function addFromNoradId(noradId: string) {
  const record = await fetchCelestrakSatellite(normalizeNoradId(noradId));
  return upsertSatellite(record);
}

export async function addFromNoradIds(raw: string) {
  const ids = parseNoradIds(raw);
  if (ids.length === 0) {
    throw new Error("Paste one or more NORAD IDs (one per line, or comma-separated).");
  }

  const outcomes = new Map<
    string,
    { record?: SatelliteRecord; error?: string }
  >();
  await Promise.all(
    Array.from({ length: Math.min(4, ids.length) }, async (_, workerIndex) => {
      for (let index = workerIndex; index < ids.length; index += 4) {
        const id = ids[index];
        try {
          outcomes.set(id, { record: await addFromNoradId(id) });
        } catch (caught) {
          outcomes.set(id, {
            error: caught instanceof Error ? caught.message : "Request failed."
          });
        }
      }
    })
  );
  const added = ids.flatMap((id) => {
    const record = outcomes.get(id)?.record;
    return record ? [record] : [];
  });
  const failures = ids.flatMap((id) => {
    const error = outcomes.get(id)?.error;
    return error ? [{ id, error }] : [];
  });

  if (added.length === 0) {
    throw new Error(
      failures.map((failure) => `${failure.id}: ${failure.error}`).join(" · ")
    );
  }

  return { added, failures };
}

export async function refreshSatellite(id: string) {
  const existing = await db.satellites.get(id);
  if (!existing) {
    throw new Error("Satellite not found.");
  }

  const refreshed = await refreshSatelliteRecord(existing);
  return upsertSatellite({
    ...refreshed,
    notes: existing.notes,
    tags: existing.tags
  });
}

export async function importFromTleSource(source: TleSource) {
  const seenIds = new Set<string>();
  let batch: SatelliteRecord[] = [];
  let importedCount = 0;

  for await (const record of iterateTleSource(source)) {
    if (seenIds.has(record.id)) {
      continue;
    }
    seenIds.add(record.id);
    batch.push(record);
    importedCount += 1;
    if (batch.length >= 500) {
      await db.satellites.bulkPut(batch);
      batch = [];
    }
  }

  if (batch.length > 0) {
    await db.satellites.bulkPut(batch);
  }
  return importedCount;
}

export async function removeSatellite(id: string) {
  await db.transaction("rw", db.satellites, db.watchlists, async () => {
    await db.satellites.delete(id);
    const watchlists = await db.watchlists.toArray();
    await Promise.all(
      watchlists
        .filter((watchlist) => watchlist.satelliteIds.includes(id))
        .map((watchlist) =>
          db.watchlists.update(watchlist.id, {
            satelliteIds: watchlist.satelliteIds.filter((satelliteId) => satelliteId !== id)
          })
        )
    );
  });
}

export async function toggleWatchlistSatellite(watchlistId: string, satelliteId: string) {
  const watchlist = await db.watchlists.get(watchlistId);
  if (!watchlist) {
    throw new Error("Watchlist not found.");
  }

  const exists = watchlist.satelliteIds.includes(satelliteId);
  const satelliteIds = exists
    ? watchlist.satelliteIds.filter((id) => id !== satelliteId)
    : [satelliteId, ...watchlist.satelliteIds];

  await db.watchlists.update(watchlistId, { satelliteIds });
  return satelliteIds;
}

export async function getWatchlistSatellites(watchlistId = "default") {
  const watchlist = await db.watchlists.get(watchlistId);
  if (!watchlist) {
    return [];
  }

  const records = await db.satellites.where("id").anyOf(watchlist.satelliteIds).toArray();
  const recordsById = new Map(records.map((record) => [record.id, record]));
  return watchlist.satelliteIds.flatMap((id) => {
    const record = recordsById.get(id);
    return record ? [record] : [];
  });
}
