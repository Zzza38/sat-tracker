import { describe, expect, it } from "vitest";
import { createSatelliteRecord, parseElementInput, validateTleChecksum } from "@/shared/tle/parser";
import { ISS_TLE } from "@/shared/__tests__/fixtures";

describe("tle parser", () => {
  it("parses a known ISS two-line set", () => {
    const parsed = parseElementInput(`${ISS_TLE.line1}\n${ISS_TLE.line2}`);
    expect(parsed.noradId).toBe("25544");
    expect(parsed.format).toBe("tle");
    expect(parsed.tle?.line1).toBe(ISS_TLE.line1);
  });

  it("validates checksums", () => {
    expect(validateTleChecksum(ISS_TLE.line1)).toBe(true);
    expect(validateTleChecksum(ISS_TLE.line2)).toBe(true);
  });

  it("creates a satellite record", () => {
    const parsed = parseElementInput(`${ISS_TLE.name}\n${ISS_TLE.line1}\n${ISS_TLE.line2}`);
    const record = createSatelliteRecord(parsed, "manual");
    expect(record.name).toBe(ISS_TLE.name);
    expect(record.source).toBe("manual");
  });
});
