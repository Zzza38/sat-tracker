import { db } from "@/shared/db";
import { createSatelliteRecord, parseElementInput } from "@/shared/tle/parser";

/**
 * Bundled starter catalog used when the app cannot reach CelesTrak.
 * Epochs are from a known good snapshot; users should refresh when online.
 */
export const OFFLINE_SEED_TLES = [
  `ISS (ZARYA)
1 25544U 98067A   26217.02190500  .00005828  00000+0  11248-3 0  9996
2 25544  51.6318  58.4155 0007310  13.5287 346.5896 15.49349819579321`,
  `CSS (TIANHE)
1 48274U 21035A   26216.91419447  .00015580  00000+0  19980-3 0  9990
2 48274  41.4694  26.1943 0000984 275.7365  84.3361 15.58808372300775`,
  `HST
1 20580U 90037B   26217.09672094  .00005287  00000+0  16256-3 0  9993
2 20580  28.4727 106.1607 0001998 339.8765  20.1753 15.31273914796079`,
  `NOAA 20 (JPSS-1)
1 43013U 17073A   26217.13019998  .00000033  00000+0  36679-4 0  9997
2 43013  98.7777 156.1602 0001929 100.2239 259.9155 14.19519860451412`,
  `SUOMI NPP
1 37849U 11061A   26217.18723715  .00000025  00000+0  33052-4 0  9995
2 37849  98.7962 157.7314 0001893 148.4710 211.6580 14.19526347765393`,
  `NOAA 19
1 33591U 09005A   26217.24695377  .00000008  00000+0  28158-4 0  9991
2 33591  98.9492 288.1504 0012773 249.8404 110.1395 14.13481062901418`,
  `NOAA 18
1 28654U 05018A   26217.23934712  .00000025  00000+0  36415-4 0  9997
2 28654  98.8095 296.2006 0014416  16.1817 343.9813 14.13737551 93247`,
  `NOAA 15
1 25338U 98030A   26217.26244812  .00000065  00000+0  44199-4 0  9999
2 25338  98.5065 236.5683 0009831 197.0640 163.0212 14.27159810468299`,
  `METEOR-M 2
1 40069U 14037A   26217.27761803  .00000302  00000+0  15755-3 0  9996
2 40069  98.5161 191.2878 0004550 252.3604 107.7077 14.21474673626296`
] as const;

export function buildOfflineSeedRecords() {
  return OFFLINE_SEED_TLES.map((raw) => createSatelliteRecord(parseElementInput(raw), "seed"));
}

/** Insert the bundled starter catalog when the local DB has no satellites. */
export async function seedOfflineCatalog() {
  const existing = await db.satellites.count();
  if (existing > 0) {
    return 0;
  }

  const records = buildOfflineSeedRecords();
  await db.satellites.bulkPut(records);

  const watchlist = await db.watchlists.get("default");
  if (watchlist && watchlist.satelliteIds.length === 0) {
    const iss = records.find((record) => record.noradId === "25544");
    if (iss) {
      await db.watchlists.update("default", { satelliteIds: [iss.id] });
    }
  }

  return records.length;
}

export function isBrowserOnline() {
  if (typeof navigator === "undefined") {
    return true;
  }
  return navigator.onLine;
}
