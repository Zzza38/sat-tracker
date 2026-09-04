import { describe, expect, it } from "vitest";
import { getVisibleNavItems } from "../navItems";

describe("visible navigation", () => {
  it("omits the AR finder when the device has no motion sensors", () => {
    expect(getVisibleNavItems(false).map((item) => item.id)).toEqual([
      "catalog",
      "tracker",
      "passes",
      "details",
      "settings"
    ]);
  });

  it("keeps the AR finder when motion sensors are available", () => {
    expect(getVisibleNavItems(true).some((item) => item.id === "ar")).toBe(true);
  });
});
