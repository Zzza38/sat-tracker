import { describe, expect, it } from "vitest";
import { passReminderId } from "../passReminders";

describe("passReminderId", () => {
  it("stays stable when recalculating the same pass with millisecond drift", () => {
    const first = passReminderId({
      satelliteId: "25544",
      aos: "2026-07-24T14:42:29.152Z"
    });
    const recalculated = passReminderId({
      satelliteId: "25544",
      aos: "2026-07-24T14:42:28.731Z"
    });

    expect(recalculated).toBe(first);
  });
});
