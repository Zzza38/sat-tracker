import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ISS_TLE } from "@/shared/__tests__/fixtures";

describe("catalog persistence", () => {
  beforeEach(async () => {
    const { db, ensureSeedData } = await import("@/shared/db");
    await db.delete();
    await db.open();
    await ensureSeedData();
  });

  afterEach(async () => {
    const { db } = await import("@/shared/db");
    await db.delete();
  });

  it("removes a satellite from the catalog and watchlist and remembers the exclusion", async () => {
    const { db, getSettings } = await import("@/shared/db");
    const { addManualElements, removeSatellite, toggleWatchlistSatellite } = await import("@/shared/catalog/service");
    const record = await addManualElements(`${ISS_TLE.name}\n${ISS_TLE.line1}\n${ISS_TLE.line2}`);
    await toggleWatchlistSatellite("default", record.id);

    await removeSatellite(record.id);

    expect(await db.satellites.get(record.id)).toBeUndefined();
    expect((await db.watchlists.get("default"))?.satelliteIds).not.toContain(record.id);
    expect((await getSettings()).hiddenSatelliteIds).toContain(record.id);
  });
});
