import { describe, expect, it, vi } from "vitest";
import { passReminderId, togglePassReminder } from "../passReminders";
import type { PassPrediction } from "@/shared/types";

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

  it("reports a blocked storage write instead of throwing", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const pass = {
      satelliteId: "25544",
      satelliteName: "ISS",
      aos: "2026-07-24T14:42:29.152Z",
      los: "2026-07-24T14:52:29.152Z",
      tca: "2026-07-24T14:47:29.152Z",
      maxElevationDeg: 45,
      durationSec: 600,
      aosAzimuthDeg: 10,
      tcaAzimuthDeg: 100,
      losAzimuthDeg: 190,
      rangeKmAtTca: 500,
      illuminated: true,
      samples: []
    } satisfies PassPrediction;

    expect(togglePassReminder(pass)).toBeNull();
    setItem.mockRestore();
  });
});
