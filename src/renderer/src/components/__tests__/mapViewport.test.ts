import { describe, expect, it } from "vitest";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../worldMap";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  centerViewportOn,
  clientDeltaToViewBox,
  clientToViewBox,
  clampPanY,
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

  it("uses contain/meet projection when zoomed out for letterboxing", () => {
    const projection = getSvgProjection({ width: 800, height: 380 }, "contain");
    expect(projection.scale).toBeCloseTo(380 / WORLD_HEIGHT, 5);
    expect(projection.offsetY).toBe(0);
    expect(projection.offsetX).toBeGreaterThan(0);
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

  it("allows zooming out below 1× for horizontal overscan", () => {
    const zoomedOut = zoomViewport({ panX: 0, panY: 0, zoom: 1 }, 0.5, {
      x: WORLD_WIDTH / 2,
      y: WORLD_HEIGHT / 2
    });
    expect(zoomedOut.zoom).toBe(0.5);
    expect(zoomedOut.panY).toBeCloseTo((WORLD_HEIGHT - WORLD_HEIGHT * 0.5) / 2, 5);

    const clamped = zoomViewport(zoomedOut, 0.01, { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 });
    expect(clamped.zoom).toBe(MIN_ZOOM);
  });

  it("letterboxes vertically when zoomed out past the map edges", () => {
    expect(clampPanY(0, 0.5)).toBeCloseTo((WORLD_HEIGHT - WORLD_HEIGHT * 0.5) / 2, 5);
    expect(clampPanY(999, 0.4)).toBeCloseTo((WORLD_HEIGHT - WORLD_HEIGHT * 0.4) / 2, 5);
  });

  it("pans and clamps vertical travel at the current zoom", () => {
    const panned = panViewport({ panX: 10, panY: 0, zoom: 2 }, 5, -1000);
    expect(panned.panX).toBe(15);
    expect(panned.panY).toBe(WORLD_HEIGHT - WORLD_HEIGHT * 2);
  });

  it("centers on a projected point", () => {
    const centered = centerViewportOn({ panX: 0, panY: 0, zoom: 1 }, { x: 360, y: 180 }, 2);
    expect(centered.zoom).toBe(2);
    expect(centered.panX).toBeCloseTo(WORLD_WIDTH / 2 - 360 * 2, 5);
    expect(centered.panY).toBeCloseTo(clampPanY(WORLD_HEIGHT / 2 - 180 * 2, 2), 5);
  });

  it("computes pinch distance and midpoint", () => {
    const a = { clientX: 0, clientY: 0 };
    const b = { clientX: 6, clientY: 8 };
    expect(pointerDistance(a, b)).toBe(10);
    expect(pointerMidpoint(a, b)).toEqual({ clientX: 3, clientY: 4 });
  });
});
