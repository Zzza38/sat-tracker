import { describe, expect, it } from "vitest";
import { buildOfflineSeedRecords, OFFLINE_SEED_TLES } from "@/shared/catalog/offline-seed";
import { validateTleChecksum } from "@/shared/tle/parser";

describe("offline seed catalog", () => {
  it("includes a useful starter set with valid checksummed TLEs", () => {
    const records = buildOfflineSeedRecords();
    expect(records.length).toBe(OFFLINE_SEED_TLES.length);
    expect(records.length).toBeGreaterThanOrEqual(5);

    const byId = new Map(records.map((record) => [record.noradId, record]));
    expect(byId.has("25544")).toBe(true);
    expect(byId.has("20580")).toBe(true);
    expect(byId.has("43013")).toBe(true);

    for (const record of records) {
      expect(record.source).toBe("seed");
      expect(record.id).toBe(record.noradId);
      expect(record.tle?.line1.startsWith("1 ")).toBe(true);
      expect(record.tle?.line2.startsWith("2 ")).toBe(true);
      expect(validateTleChecksum(record.tle!.line1)).toBe(true);
      expect(validateTleChecksum(record.tle!.line2)).toBe(true);
    }
  });
});
