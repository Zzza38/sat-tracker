import { describe, expect, it } from "vitest";
import { elevationToColor } from "@/shared/passes/elevation-color";

describe("elevation color scale", () => {
  it("maps low elevation to red and high elevation to semi-neon green", () => {
    expect(elevationToColor(0)).toMatch(/^hsl\(12 /);
    expect(elevationToColor(90)).toMatch(/^hsl\(140 /);
  });

  it("respects the observer horizon mask as the scale minimum", () => {
    expect(elevationToColor(10, { minElevationDeg: 10, maxElevationDeg: 90 })).toMatch(/^hsl\(12 /);
    expect(elevationToColor(90, { minElevationDeg: 10, maxElevationDeg: 90 })).toMatch(/^hsl\(140 /);
  });

  it("clamps elevations outside the scale domain", () => {
    expect(elevationToColor(-20)).toBe(elevationToColor(0));
    expect(elevationToColor(500)).toBe(elevationToColor(90));
  });
});
