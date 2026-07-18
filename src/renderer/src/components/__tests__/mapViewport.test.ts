import { describe, expect, it } from "vitest";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../worldMap";
import {
  MAX_ZOOM,
  clientDeltaToViewBox,
  clientToViewBox,
  getSvgProjection,
  panViewport,
  pointerDistance,
  pointerMidpoint,
  zoomViewport
} from "../mapViewport";

describe("mapViewport", () => {
  it("uses slice/cover projection on tall mobile frames", () => {
    const projection = getSvgProjection({ width: 366, height: 390 });
    expect(projection.scale).toBeCloseTo(390 / WORLD_HEIGHT, 5);
    expect(projection.offsetY).toBe(0);
    expect(projection.offsetX).toBeLessThan(0);
  });

  it("maps client coordinates through the cover projection", () => {
    const bounds = { left: 10, top: 20, width: 366, height: 390 };
    const projection = getSvgProjection(bounds);
    const point = clientToViewBox(bounds, 10 + bounds.width / 2, 20 + bounds.height / 2);

    expect(point.x).toBeCloseTo(WORLD_WIDTH / 2, 5);
    expect(point.y).toBeCloseTo((bounds.height / 2 - projection.offsetY) / projection.scale, 5);
  });

  it("converts pointer deltas with the projection scale", () => {
    const bounds = { width: 366, height: 390 };
    const projection = getSvgProjection(bounds);
    const delta = clientDeltaToViewBox(bounds, projection.scale * 12, projection.scale * -8);

    expect(delta.x).toBeCloseTo(12, 5);
    expect(delta.y).toBeCloseTo(-8, 5);
  });

  it("zooms around an anchor and clamps to the max zoom", () => {
    const zoomed = zoomViewport({ panX: 0, panY: 0, zoom: 1 }, 2, {
      x: WORLD_WIDTH / 2,
      y: WORLD_HEIGHT / 2
    });
    expect(zoomed.zoom).toBe(2);

    const clamped = zoomViewport(zoomed, 100, { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 });
    expect(clamped.zoom).toBe(MAX_ZOOM);
  });

  it("pans and clamps vertical travel at the current zoom", () => {
    const panned = panViewport({ panX: 10, panY: 0, zoom: 2 }, 5, -1000);
    expect(panned.panX).toBe(15);
    expect(panned.panY).toBe(WORLD_HEIGHT - WORLD_HEIGHT * 2);
  });

  it("computes pinch distance and midpoint", () => {
    const a = { clientX: 0, clientY: 0 };
    const b = { clientX: 6, clientY: 8 };
    expect(pointerDistance(a, b)).toBe(10);
    expect(pointerMidpoint(a, b)).toEqual({ clientX: 3, clientY: 4 });
  });
});
