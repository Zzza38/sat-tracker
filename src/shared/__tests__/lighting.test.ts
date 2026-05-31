import { describe, expect, it } from "vitest";
import { getNightFootprint, getSunSubpoint } from "@/shared/astro/lighting";

describe("astro lighting", () => {
  it("computes the Sun subpoint from solar declination rather than the AU position vector", () => {
    const sun = getSunSubpoint(new Date("2026-05-31T16:00:00Z"));

    expect(sun.latitudeDeg).toBeGreaterThan(21);
    expect(sun.latitudeDeg).toBeLessThan(23);
    expect(sun.longitudeDeg).toBeGreaterThan(-62);
    expect(sun.longitudeDeg).toBeLessThan(-58);
  });

  it("keeps the solstice Sun subpoint near the tropic instead of the pole", () => {
    const sun = getSunSubpoint(new Date("2026-06-21T08:00:00Z"));

    expect(sun.latitudeDeg).toBeGreaterThan(23);
    expect(sun.latitudeDeg).toBeLessThan(24);
    expect(Math.abs(sun.latitudeDeg)).toBeLessThan(25);
  });

  it("keeps the equinox Sun subpoint near the equator", () => {
    const sun = getSunSubpoint(new Date("2026-03-20T14:46:00Z"));

    expect(Math.abs(sun.latitudeDeg)).toBeLessThan(0.5);
  });

  it("builds terminator footprint samples on the day/night boundary", () => {
    const footprint = getNightFootprint(new Date("2026-05-31T16:00:00Z"), 36);

    expect(footprint).toHaveLength(36);
    expect(Math.max(...footprint.map((point) => Math.abs(point.latitudeDeg)))).toBeLessThanOrEqual(90);
    expect(Math.max(...footprint.map((point) => Math.abs(point.longitudeDeg)))).toBeLessThanOrEqual(180);
  });
});
