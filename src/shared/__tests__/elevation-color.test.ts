import { describe, expect, it } from "vitest";
import { elevationToColor } from "@/shared/passes/elevation-color";

function parseRgb(color: string): [number, number, number] {
  const match = color.match(/^rgb\((\d+) (\d+) (\d+)\)$/);
  if (!match) {
    throw new Error(`Unexpected color format: ${color}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const linearize = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

describe("elevation color scale", () => {
  it("ramps luminance strictly upward from horizon to zenith", () => {
    const luminances = [0, 30, 60, 90].map((elevation) =>
      relativeLuminance(parseRgb(elevationToColor(elevation)))
    );

    for (let i = 1; i < luminances.length; i++) {
      expect(luminances[i]).toBeGreaterThan(luminances[i - 1]);
    }
  });

  it("respects the observer horizon mask as the scale minimum", () => {
    expect(elevationToColor(10, { minElevationDeg: 10, maxElevationDeg: 90 })).toBe(
      elevationToColor(0)
    );
    expect(elevationToColor(90, { minElevationDeg: 10, maxElevationDeg: 90 })).toBe(
      elevationToColor(90)
    );
  });

  it("clamps elevations outside the scale domain", () => {
    expect(elevationToColor(-20)).toBe(elevationToColor(0));
    expect(elevationToColor(500)).toBe(elevationToColor(90));
  });
});
