import { describe, expect, it } from "vitest";
import { parseNoradIds } from "@/shared/catalog/service";
import { formatDuration } from "@/shared/utils/date";

describe("catalog helpers", () => {
  it("deduplicates valid NORAD IDs and rejects invalid ranges", () => {
    expect(parseNoradIds("25544, 25544\n43013 0 -1 1234567890 abc")).toEqual([
      "25544",
      "43013"
    ]);
  });

  it("formats rounded durations without a 60-second remainder", () => {
    expect(formatDuration(119.8)).toBe("2m 0s");
  });
});
