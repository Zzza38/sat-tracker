import { WORLD_HEIGHT, WORLD_WIDTH } from "./worldMap";

/** Allow zooming out below 1× so the map letterboxes and more longitude is visible. */
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 6;

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
 * - zoom >= 1: keep the map covering the viewBox vertically (no empty bands).
 * - zoom < 1: center the smaller map and allow only the letterbox position so
 *   emptiness fills above/below while more longitude stays in view.
 */
export function clampPanY(value: number, zoom: number) {
  if (zoom < 1) {
    return (WORLD_HEIGHT - WORLD_HEIGHT * zoom) / 2;
  }

  if (zoom <= 1) {
    return 0;
  }

  return clamp(value, WORLD_HEIGHT - WORLD_HEIGHT * zoom, 0);
}

export type SvgFitMode = "cover" | "contain";

/** Cover/slice fills the element; contain/meet letterboxes so the full viewBox stays visible. */
export function getSvgProjection(
  bounds: { width: number; height: number },
  fit: SvgFitMode = "cover"
): SvgProjection {
  const width = Math.max(bounds.width, 1);
  const height = Math.max(bounds.height, 1);
  const scale =
    fit === "contain"
      ? Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT)
      : Math.max(width / WORLD_WIDTH, height / WORLD_HEIGHT);

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
  clientY: number,
  fit: SvgFitMode = "cover"
): Point {
  const projection = getSvgProjection(bounds, fit);
  return {
    x: (clientX - bounds.left - projection.offsetX) / projection.scale,
    y: (clientY - bounds.top - projection.offsetY) / projection.scale
  };
}

export function clientDeltaToViewBox(
  bounds: { width: number; height: number },
  deltaX: number,
  deltaY: number,
  fit: SvgFitMode = "cover"
): Point {
  const { scale } = getSvgProjection(bounds, fit);
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

/** Center the viewport on a lon/lat point at the given (or current) zoom. */
export function centerViewportOn(
  current: MapViewport,
  point: Point,
  zoom = current.zoom
): MapViewport {
  const nextZoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  return {
    zoom: nextZoom,
    panX: WORLD_WIDTH / 2 - point.x * nextZoom,
    panY: clampPanY(WORLD_HEIGHT / 2 - point.y * nextZoom, nextZoom)
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
