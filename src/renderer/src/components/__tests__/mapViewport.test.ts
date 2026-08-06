import { describe, expect, it } from "vitest";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../worldMap";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampPanY,
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

  it("zooms around an anchor and clamps to the zoom range", () => {
    const zoomed = zoomViewport({ panX: 0, panY: 0, zoom: 1 }, 2, {
      x: WORLD_WIDTH / 2,
      y: WORLD_HEIGHT / 2
    });
    expect(zoomed.zoom).toBe(2);

    const clampedIn = zoomViewport(zoomed, 100, { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 });
    expect(clampedIn.zoom).toBe(MAX_ZOOM);

    const zoomedOut = zoomViewport({ panX: 0, panY: 0, zoom: 1 }, 0.01, {
      x: WORLD_WIDTH / 2,
      y: WORLD_HEIGHT / 2
    });
    expect(zoomedOut.zoom).toBe(MIN_ZOOM);
    // Zooming out from center leaves polar padding above/below the map.
    expect(zoomedOut.panY).toBeGreaterThan(0);
    expect(zoomedOut.panY).toBeLessThan(WORLD_HEIGHT - WORLD_HEIGHT * MIN_ZOOM);
  });

  it("allows panning past the poles when zoomed out", () => {
    const zoom = 0.5;
    const centered = (WORLD_HEIGHT - WORLD_HEIGHT * zoom) / 2;
    expect(clampPanY(centered, zoom)).toBeCloseTo(centered, 5);
    expect(clampPanY(-10_000, zoom)).toBeLessThan(0);
    expect(clampPanY(10_000, zoom)).toBeGreaterThan(WORLD_HEIGHT - WORLD_HEIGHT * zoom);
  });

  it("pans and clamps vertical travel at the current zoom", () => {
    const panned = panViewport({ panX: 10, panY: 0, zoom: 2 }, 5, -1000);
    expect(panned.panX).toBe(15);
    // Zoomed-in clamp still keeps most of the map in view, with a little polar overshoot.
    expect(panned.panY).toBe(WORLD_HEIGHT - WORLD_HEIGHT * 2 - WORLD_HEIGHT * 0.2);
  });

  it("computes pinch distance and midpoint", () => {
    const a = { clientX: 0, clientY: 0 };
    const b = { clientX: 6, clientY: 8 };
    expect(pointerDistance(a, b)).toBe(10);
    expect(pointerMidpoint(a, b)).toEqual({ clientX: 3, clientY: 4 });
  });
});
