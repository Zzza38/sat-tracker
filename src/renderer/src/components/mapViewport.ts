import { WORLD_HEIGHT, WORLD_WIDTH } from "./worldMap";

/** Allow zooming out far enough to see polar padding and more longitude. */
export const MIN_ZOOM = 0.45;
export const MAX_ZOOM = 6;

/** Extra viewBox padding (as a fraction of world size) past map edges when zoomed out. */
const EDGE_OVERSHOOT = 0.2;

export interface MapViewport {
  panX: number;
  panY: number;
  zoom: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface SvgProjection {
  scale: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Vertical pan limits.
 * - Zoomed in: keep the map covering the view, with a small overshoot past the poles.
 * - Zoomed out: allow the map to sit inside the view with padding above/below (and a
 *   bit past the edges) so top/bottom and more of the sides are visible.
 */
export function clampPanY(value: number, zoom: number) {
  const scaledHeight = WORLD_HEIGHT * zoom;
  const overshoot = WORLD_HEIGHT * EDGE_OVERSHOOT;

  if (scaledHeight <= WORLD_HEIGHT) {
    const maxPan = WORLD_HEIGHT - scaledHeight;
    return clamp(value, -overshoot, maxPan + overshoot);
  }

  return clamp(value, WORLD_HEIGHT - scaledHeight - overshoot, overshoot);
}

/** Cover/slice projection so the map fills the element without letterboxing. */
export function getSvgProjection(bounds: { width: number; height: number }): SvgProjection {
  const width = Math.max(bounds.width, 1);
  const height = Math.max(bounds.height, 1);
  const scale = Math.max(width / WORLD_WIDTH, height / WORLD_HEIGHT);

  return {
    scale,
    offsetX: (width - WORLD_WIDTH * scale) / 2,
    offsetY: (height - WORLD_HEIGHT * scale) / 2,
    width,
    height
  };
}

export function clientToViewBox(
  bounds: DOMRect | { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number
): Point {
  const projection = getSvgProjection(bounds);
  return {
    x: (clientX - bounds.left - projection.offsetX) / projection.scale,
    y: (clientY - bounds.top - projection.offsetY) / projection.scale
  };
}

export function clientDeltaToViewBox(
  bounds: { width: number; height: number },
  deltaX: number,
  deltaY: number
): Point {
  const { scale } = getSvgProjection(bounds);
  return {
    x: deltaX / scale,
    y: deltaY / scale
  };
}

export function zoomViewport(
  current: MapViewport,
  factor: number,
  anchor: Point = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 }
): MapViewport {
  const nextZoom = clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  if (nextZoom === current.zoom) {
    return current;
  }

  const worldX = (anchor.x - current.panX) / current.zoom;
  const worldY = (anchor.y - current.panY) / current.zoom;

  return {
    zoom: nextZoom,
    panX: anchor.x - worldX * nextZoom,
    panY: clampPanY(anchor.y - worldY * nextZoom, nextZoom)
  };
}

export function panViewport(current: MapViewport, deltaX: number, deltaY: number): MapViewport {
  return {
    ...current,
    panX: current.panX + deltaX,
    panY: clampPanY(current.panY + deltaY, current.zoom)
  };
}

export function pointerDistance(
  a: { clientX: number; clientY: number },
  b: { clientX: number; clientY: number }
) {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.hypot(dx, dy);
}

export function pointerMidpoint(
  a: { clientX: number; clientY: number },
  b: { clientX: number; clientY: number }
) {
  return {
    clientX: (a.clientX + b.clientX) / 2,
    clientY: (a.clientY + b.clientY) / 2
  };
}
