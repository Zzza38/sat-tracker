import { describe, expect, it } from "vitest";
import { createSatelliteRecord, parseElementInput, validateTleChecksum } from "@/shared/tle/parser";
import { ISS_OMM, ISS_TLE } from "@/shared/__tests__/fixtures";

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

  it("parses OMM JSON and three-line TLE input", () => {
    const omm = parseElementInput(JSON.stringify(ISS_OMM));
    const threeLine = parseElementInput(`${ISS_TLE.name}\n${ISS_TLE.line1}\n${ISS_TLE.line2}`);

    expect(omm.format).toBe("omm");
    expect(omm.noradId).toBe("25544");
    expect(threeLine.name).toBe(ISS_TLE.name);
  });

  it("rejects empty and bad-checksum TLE input", () => {
    expect(() => parseElementInput("  ")).toThrow();
    const badLine1 = `${ISS_TLE.line1.slice(0, -1)}${ISS_TLE.line1.endsWith("0") ? "1" : "0"}`;
    expect(() => parseElementInput(`${badLine1}\n${ISS_TLE.line2}`)).toThrow(/checksum/i);
  });
});
