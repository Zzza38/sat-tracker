import {
  directionVector,
  normalizeDegrees,
  offAxisAngleDeg,
  projectDirection,
  signedAngleDifference,
  viewBasis,
  type CameraBasis,
  type FieldOfView,
  type LookAngles,
  type ProjectedPoint,
  type ViewDirection
} from "./ar";

/**
 * Imperative canvas renderer for the AR stage. Everything that moves with the
 * camera is drawn here once per animation frame from refs, so orientation
 * changes never touch React state or the DOM: the old SVG overlay re-rendered
 * the whole component tree per frame, which is where most of the perceived
 * lag came from.
 */

export interface ArSceneTarget {
  id: string;
  name: string;
  color: string;
  selected: boolean;
  azimuthDeg: number;
  elevationDeg: number;
  rangeKm: number;
  /** Future look angles at one-minute steps, for the sky trail. */
  orbit: LookAngles[];
}

export interface ArScene {
  width: number;
  height: number;
  view: ViewDirection;
  fov: FieldOfView;
  targets: ArSceneTarget[];
  /** Dish-face crosshair for the selected target when a dish offset is set. */
  dishTarget: LookAngles | null;
  /** The point the user should centre; drives the reticle lock + edge cue. */
  guidanceTarget: LookAngles | null;
  /**
   * Separately-stabilised heading for the compass ribbon. The boresight
   * heading swings wildly when the camera is pitched up (1/cos(elevation)
   * amplification), so the readout gets its own heavier smoothing.
   */
  ribbonHeadingDeg?: number;
  timeMs: number;
}

export interface ArHitRegion {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export interface ArRenderResult {
  hits: ArHitRegion[];
  /** Whether the guidance target is currently on screen. */
  guidanceOnScreen: boolean;
  /** Boresight-to-guidance-target separation, degrees. */
  guidanceOffAxisDeg: number | null;
}

const MONO_FONT = '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace';
const HALO = "rgba(2, 6, 10, 0.88)";
const GOLD = "#ffcc66";
const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export function cardinalLabel(headingDeg: number) {
  return CARDINALS[Math.round(normalizeDegrees(headingDeg) / 45) % 8];
}

function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string,
  haloWidth = 3
) {
  ctx.strokeStyle = HALO;
  ctx.lineWidth = haloWidth;
  ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

// --- Horizon --------------------------------------------------------------

function drawHorizon(
  ctx: CanvasRenderingContext2D,
  scene: ArScene,
  basis: CameraBasis
) {
  const { width, height, view, fov } = scene;
  const project = (az: number, el: number) =>
    projectDirection(directionVector(az, el), basis, width, height, fov);

  const a = project(view.headingDeg - 30, 0);
  const b = project(view.headingDeg + 30, 0);
  if (a.behind || b.behind) {
    return;
  }

  // The horizon is a great circle, so in a gnomonic projection it is exactly
  // the straight line through any two of its points; extend across the stage.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) {
    return;
  }
  const ux = dx / length;
  const uy = dy / length;
  const reach = width + height;

  ctx.save();
  ctx.strokeStyle = "rgba(214, 233, 244, 0.34)";
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(a.x - ux * reach, a.y - uy * reach);
  ctx.lineTo(a.x + ux * reach, a.y + uy * reach);
  ctx.stroke();

  // Azimuth ticks standing on the horizon, cardinal labels every 45 degrees.
  ctx.font = `600 11px ${MONO_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const start = Math.ceil((view.headingDeg - fov.horizontalDeg) / 15) * 15;
  const end = view.headingDeg + fov.horizontalDeg;
  for (let az = start; az <= end; az += 15) {
    const base = project(az, 0);
    if (!base.visible && !(base.x > -60 && base.x < width + 60 && base.y > -60 && base.y < height + 60)) {
      continue;
    }
    if (base.behind) {
      continue;
    }
    const tip = project(az, 1.6);
    if (tip.behind) {
      continue;
    }
    let tx = tip.x - base.x;
    let ty = tip.y - base.y;
    const tickLength = Math.hypot(tx, ty);
    if (tickLength < 1e-6) {
      continue;
    }
    tx /= tickLength;
    ty /= tickLength;

    const cardinal = normalizeDegrees(az) % 45 === 0;
    const size = cardinal ? 9 : 5;
    ctx.strokeStyle = cardinal ? "rgba(228, 242, 250, 0.6)" : "rgba(214, 233, 244, 0.3)";
    ctx.lineWidth = cardinal ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(base.x + tx * size, base.y + ty * size);
    ctx.stroke();

    if (cardinal) {
      const label = cardinalLabel(az);
      haloText(
        ctx,
        label,
        base.x + tx * (size + 11),
        base.y + ty * (size + 11),
        label.length === 1 ? "rgba(240, 249, 255, 0.85)" : "rgba(222, 237, 246, 0.6)"
      );
    }
  }
  ctx.restore();
}

// --- Orbit trails -----------------------------------------------------------

function orbitScreenSegments(
  orbit: LookAngles[],
  basis: CameraBasis,
  scene: ArScene
): { x: number; y: number; index: number }[][] {
  const { width, height, fov } = scene;
  const segments: { x: number; y: number; index: number }[][] = [];
  let segment: { x: number; y: number; index: number }[] = [];

  orbit.forEach((point, index) => {
    const projected = projectDirection(
      directionVector(point.azimuthDeg, point.elevationDeg),
      basis,
      width,
      height,
      fov
    );
    const withinMargin =
      !projected.behind &&
      projected.x >= -width * 0.15 &&
      projected.x <= width * 1.15 &&
      projected.y >= -height * 0.15 &&
      projected.y <= height * 1.15 &&
      point.elevationDeg >= -8;

    if (withinMargin) {
      segment.push({ x: projected.x, y: projected.y, index });
    } else {
      if (segment.length > 1) {
        segments.push(segment);
      }
      segment = [];
    }
  });

  if (segment.length > 1) {
    segments.push(segment);
  }
  return segments;
}

function drawOrbits(
  ctx: CanvasRenderingContext2D,
  scene: ArScene,
  basis: CameraBasis
) {
  ctx.save();
  ctx.lineCap = "round";
  for (const target of scene.targets) {
    if (target.orbit.length < 2) {
      continue;
    }
    const segments = orbitScreenSegments(target.orbit, basis, scene);
    ctx.strokeStyle = target.color;
    ctx.globalAlpha = target.selected ? 0.8 : 0.28;
    ctx.lineWidth = target.selected ? 1.8 : 1.1;
    ctx.setLineDash(target.selected ? [] : [4, 8]);
    for (const segment of segments) {
      ctx.beginPath();
      segment.forEach((point, i) => {
        if (i === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.stroke();
    }

    if (target.selected) {
      // Minute marks along the selected trail, labelled every ten minutes,
      // so "where will it be" reads directly off the sky. Slow movers (a
      // geostationary trail collapses to a point) would pile every label onto
      // the same spot, so marks keep a minimum screen distance from the
      // previous one and vanish entirely for a degenerate trail.
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const segment of segments) {
        for (const point of segment) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
      }
      const trailSpan = Math.hypot(maxX - minX, maxY - minY);

      if (trailSpan >= 60) {
        ctx.setLineDash([]);
        ctx.font = `600 9px ${MONO_FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        let lastDot: { x: number; y: number } | null = null;
        let lastLabel: { x: number; y: number } | null = null;
        for (const segment of segments) {
          for (const point of segment) {
            if (point.index === 0 || point.index % 5 !== 0) {
              continue;
            }
            if (lastDot && Math.hypot(point.x - lastDot.x, point.y - lastDot.y) < 10) {
              continue;
            }
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            ctx.arc(point.x, point.y, point.index % 10 === 0 ? 2.4 : 1.4, 0, Math.PI * 2);
            ctx.fillStyle = target.color;
            ctx.fill();
            lastDot = point;
            if (
              point.index % 10 === 0 &&
              (!lastLabel || Math.hypot(point.x - lastLabel.x, point.y - lastLabel.y) >= 28)
            ) {
              haloText(ctx, `+${point.index}m`, point.x, point.y - 11, "rgba(234, 245, 252, 0.85)");
              lastLabel = point;
            }
          }
        }
      }
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// --- Satellite markers ------------------------------------------------------

function drawTargetMarker(
  ctx: CanvasRenderingContext2D,
  scene: ArScene,
  target: ArSceneTarget,
  projected: ProjectedPoint,
  hits: ArHitRegion[]
) {
  const { x, y } = projected;
  const belowHorizon = target.elevationDeg < 0;
  const ringRadius = target.selected ? 15 : 10;

  ctx.save();
  ctx.globalAlpha = belowHorizon ? 0.45 : 1;

  if (target.selected && !belowHorizon) {
    // Expanding ping so the tracked satellite is findable at a glance.
    const phase = (scene.timeMs % 2000) / 2000;
    ctx.beginPath();
    ctx.arc(x, y, ringRadius + 4 + phase * 14, 0, Math.PI * 2);
    ctx.strokeStyle = target.color;
    ctx.globalAlpha = (belowHorizon ? 0.45 : 1) * 0.45 * (1 - phase);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.globalAlpha = belowHorizon ? 0.45 : 1;
  }

  ctx.beginPath();
  ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(4, 9, 14, 0.55)";
  ctx.fill();
  ctx.strokeStyle = target.color;
  ctx.lineWidth = target.selected ? 2 : 1.4;
  ctx.setLineDash(belowHorizon ? [3, 4] : []);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(x, y, target.selected ? 3.4 : 2.4, 0, Math.PI * 2);
  ctx.fillStyle = target.color;
  ctx.fill();

  // Name chip above the ring.
  const nameSize = target.selected ? 11 : 10;
  ctx.font = `600 ${nameSize}px ${MONO_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const nameWidth = ctx.measureText(target.name).width;
  const chipWidth = nameWidth + 16;
  const chipHeight = nameSize + 8;
  const chipY = y - ringRadius - chipHeight - 6;
  roundedRectPath(ctx, x - chipWidth / 2, chipY, chipWidth, chipHeight, chipHeight / 2);
  ctx.fillStyle = "rgba(3, 8, 12, 0.74)";
  ctx.fill();
  ctx.strokeStyle = target.color;
  ctx.globalAlpha = (belowHorizon ? 0.45 : 1) * (target.selected ? 0.9 : 0.5);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.globalAlpha = belowHorizon ? 0.45 : 1;
  ctx.fillStyle = "#eef6fa";
  ctx.fillText(target.name, x, chipY + chipHeight / 2 + 0.5);

  if (target.selected) {
    ctx.font = `500 9.5px ${MONO_FONT}`;
    const info = belowHorizon
      ? `${target.elevationDeg.toFixed(0)}° · below horizon`
      : `EL ${target.elevationDeg.toFixed(0)}° · ${Math.round(target.rangeKm).toLocaleString()} km`;
    haloText(ctx, info, x, y + ringRadius + 13, "rgba(226, 240, 248, 0.85)");
  }

  ctx.restore();

  hits.push({ id: target.id, x, y, radius: Math.max(24, ringRadius + 10) });
}

// --- Dish-face crosshair ------------------------------------------------------

function drawDishMarker(
  ctx: CanvasRenderingContext2D,
  scene: ArScene,
  basis: CameraBasis
) {
  if (!scene.dishTarget) {
    return;
  }
  const projected = projectDirection(
    directionVector(scene.dishTarget.azimuthDeg, scene.dishTarget.elevationDeg),
    basis,
    scene.width,
    scene.height,
    scene.fov
  );
  if (!projected.visible) {
    return;
  }
  const { x, y } = projected;
  ctx.save();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(x, y, 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x - 30, y);
  ctx.lineTo(x - 14, y);
  ctx.moveTo(x + 14, y);
  ctx.lineTo(x + 30, y);
  ctx.moveTo(x, y - 30);
  ctx.lineTo(x, y - 14);
  ctx.moveTo(x, y + 14);
  ctx.lineTo(x, y + 30);
  ctx.stroke();
  ctx.font = `600 9px ${MONO_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  haloText(ctx, "DISH FACE", x, y + 41, GOLD);
  ctx.restore();
}

// --- Reticle ------------------------------------------------------------------

function drawReticle(
  ctx: CanvasRenderingContext2D,
  scene: ArScene,
  lockColor: string | null
) {
  const cx = scene.width / 2;
  const cy = scene.height / 2;
  const color = lockColor ?? "rgba(255, 255, 255, 0.55)";

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lockColor ? 1.8 : 1.1;
  ctx.beginPath();
  ctx.arc(cx, cy, 24, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    ctx.moveTo(cx + dx * 28, cy + dy * 28);
    ctx.lineTo(cx + dx * 36, cy + dy * 36);
  }
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 1.6, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  if (lockColor) {
    ctx.font = `600 10px ${MONO_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    haloText(ctx, "ON TARGET", cx, cy + 52, lockColor);
  }
  ctx.restore();
}

// --- Compass ribbon -------------------------------------------------------------

function drawCompassRibbon(ctx: CanvasRenderingContext2D, scene: ArScene) {
  const { width, targets } = scene;
  const heading = scene.ribbonHeadingDeg ?? scene.view.headingDeg;
  const cx = width / 2;
  const baseline = 78;
  const halfWidth = Math.min(width * 0.42, 250);
  const pxPerDeg = 3.1;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Digital heading readout above the tape.
  ctx.font = `600 17px ${MONO_FONT}`;
  haloText(
    ctx,
    `${Math.round(normalizeDegrees(heading)).toString().padStart(3, "0")}°`,
    cx,
    baseline - 36,
    "#f4fafd",
    4
  );
  ctx.font = `600 10px ${MONO_FONT}`;
  haloText(ctx, cardinalLabel(heading), cx, baseline - 20, "rgba(226, 240, 248, 0.75)");

  const edgeFade = (dx: number) => Math.max(0, 1 - (Math.abs(dx) / halfWidth) ** 2);

  // Tick tape.
  const startAz = Math.ceil((heading - halfWidth / pxPerDeg) / 5) * 5;
  const endAz = heading + halfWidth / pxPerDeg;
  for (let az = startAz; az <= endAz; az += 5) {
    const dx = signedAngleDifference(az, heading) * pxPerDeg;
    const fade = edgeFade(dx);
    if (fade <= 0.02) {
      continue;
    }
    const major = normalizeDegrees(az) % 15 === 0;
    const cardinal = normalizeDegrees(az) % 45 === 0;
    ctx.globalAlpha = fade * (major ? 0.85 : 0.4);
    ctx.strokeStyle = "rgba(235, 246, 252, 0.9)";
    ctx.lineWidth = cardinal ? 1.6 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + dx, baseline);
    ctx.lineTo(cx + dx, baseline - (cardinal ? 10 : major ? 7 : 4));
    ctx.stroke();

    if (cardinal) {
      const label = cardinalLabel(az);
      ctx.globalAlpha = fade;
      ctx.font = `600 ${label.length === 1 ? 11 : 9}px ${MONO_FONT}`;
      haloText(ctx, label, cx + dx, baseline + 9, "rgba(240, 249, 255, 0.9)");
    }
  }

  // Satellite pips under the tape; pinned to the edges when out of range.
  for (const target of targets) {
    const diff = signedAngleDifference(target.azimuthDeg, heading);
    const dx = Math.max(-halfWidth - 8, Math.min(halfWidth + 8, diff * pxPerDeg));
    const pinned = Math.abs(diff * pxPerDeg) > halfWidth + 8;
    const y = baseline + (target.selected ? 20 : 19);
    ctx.globalAlpha = target.selected ? 1 : 0.7;
    ctx.fillStyle = target.color;
    if (pinned) {
      const dir = dx > 0 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(cx + dx + dir * 4, y);
      ctx.lineTo(cx + dx - dir * 3, y - 3.5);
      ctx.lineTo(cx + dx - dir * 3, y + 3.5);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(cx + dx, y, target.selected ? 3.4 : 2.4, 0, Math.PI * 2);
      ctx.fill();
      if (target.selected) {
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = target.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx + dx, y, 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;

  // Boresight caret.
  ctx.fillStyle = "#f4fafd";
  ctx.beginPath();
  ctx.moveTo(cx, baseline - 14);
  ctx.lineTo(cx - 4, baseline - 20);
  ctx.lineTo(cx + 4, baseline - 20);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// --- Edge guidance ---------------------------------------------------------------

function drawEdgeGuidance(
  ctx: CanvasRenderingContext2D,
  scene: ArScene,
  offAxisDeg: number
) {
  const target = scene.guidanceTarget;
  if (!target) {
    return;
  }
  const { width, height, view } = scene;
  const azimuthError = signedAngleDifference(target.azimuthDeg, view.headingDeg);
  const elevationError = target.elevationDeg - view.elevationDeg;
  // Screen space, so the pointer has to unwind the device roll.
  const angle =
    Math.atan2(azimuthError, elevationError) - ((view.rollDeg ?? 0) * Math.PI) / 180;
  const dirX = Math.sin(angle);
  const dirY = -Math.cos(angle);

  const cx = width / 2;
  const cy = height / 2;
  const insetX = 48;
  const insetTop = 128;
  const insetBottom = Math.min(height * 0.34, 230);

  let scale = Number.POSITIVE_INFINITY;
  if (dirX > 1e-6) scale = Math.min(scale, (width - insetX - cx) / dirX);
  if (dirX < -1e-6) scale = Math.min(scale, (insetX - cx) / dirX);
  if (dirY > 1e-6) scale = Math.min(scale, (height - insetBottom - cy) / dirY);
  if (dirY < -1e-6) scale = Math.min(scale, (insetTop - cy) / dirY);
  if (!Number.isFinite(scale) || scale <= 0) {
    return;
  }

  const x = cx + dirX * scale;
  const y = cy + dirY * scale;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = GOLD;
  ctx.fillStyle = GOLD;
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(255, 204, 102, 0.55)";
  ctx.shadowBlur = 9;

  ctx.beginPath();
  ctx.moveTo(-9, 7);
  ctx.lineTo(0, -6);
  ctx.lineTo(9, 7);
  ctx.stroke();

  ctx.rotate(-angle);
  ctx.shadowBlur = 0;
  ctx.font = `600 11px ${MONO_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  haloText(ctx, `${Math.round(offAxisDeg)}°`, -dirX * 24, -dirY * 24 + 2, GOLD);
  ctx.restore();
}

// --- Scene entry point --------------------------------------------------------------

const RETICLE_LOCK_DEG = 2.5;

export function renderArScene(
  ctx: CanvasRenderingContext2D,
  scene: ArScene
): ArRenderResult {
  const basis = viewBasis(scene.view);
  const hits: ArHitRegion[] = [];

  ctx.clearRect(0, 0, scene.width, scene.height);

  drawHorizon(ctx, scene, basis);
  drawOrbits(ctx, scene, basis);

  // Draw the selected target last so its labels sit on top.
  const ordered = [...scene.targets].sort((a, b) => Number(a.selected) - Number(b.selected));
  for (const target of ordered) {
    const projected = projectDirection(
      directionVector(target.azimuthDeg, target.elevationDeg),
      basis,
      scene.width,
      scene.height,
      scene.fov
    );
    if (projected.visible) {
      drawTargetMarker(ctx, scene, target, projected, hits);
    }
  }

  drawDishMarker(ctx, scene, basis);

  let guidanceOnScreen = false;
  let guidanceOffAxisDeg: number | null = null;
  let lockColor: string | null = null;

  if (scene.guidanceTarget) {
    const projected = projectDirection(
      directionVector(scene.guidanceTarget.azimuthDeg, scene.guidanceTarget.elevationDeg),
      basis,
      scene.width,
      scene.height,
      scene.fov
    );
    guidanceOnScreen = projected.visible;
    guidanceOffAxisDeg = offAxisAngleDeg(
      scene.view,
      scene.guidanceTarget.azimuthDeg,
      scene.guidanceTarget.elevationDeg
    );

    if (guidanceOffAxisDeg <= RETICLE_LOCK_DEG) {
      lockColor = scene.targets.find((target) => target.selected)?.color ?? GOLD;
    }
    if (!guidanceOnScreen && scene.guidanceTarget.elevationDeg >= 0) {
      drawEdgeGuidance(ctx, scene, guidanceOffAxisDeg);
    }
  }

  drawReticle(ctx, scene, lockColor);
  drawCompassRibbon(ctx, scene);

  return { hits, guidanceOnScreen, guidanceOffAxisDeg };
}
