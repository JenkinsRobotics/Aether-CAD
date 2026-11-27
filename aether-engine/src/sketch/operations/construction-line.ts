import { validateSketchDrawing, type SketchDrawing, type SketchPoint } from "../drawing";
import type { SketchEntityRef } from "../solver/types";
import { resolve } from "../solver/entities";

export type ConstructionLineRequest =
  | { mode: "free"; start: SketchPoint; end: SketchPoint; infinite?: boolean; centerline?: boolean }
  | { mode: "horizontal"; through: SketchPoint; length?: number; infinite?: boolean; centerline?: boolean }
  | { mode: "vertical"; through: SketchPoint; length?: number; infinite?: boolean; centerline?: boolean }
  | { mode: "angle"; through: SketchPoint; angleDegrees: number; length?: number; infinite?: boolean; centerline?: boolean }
  | { mode: "parallel"; line: SketchEntityRef; offsetMillimeters?: number; through?: SketchPoint; length?: number; infinite?: boolean; centerline?: boolean }
  | { mode: "perpendicular"; line: SketchEntityRef; through: SketchPoint; length?: number; infinite?: boolean; centerline?: boolean }
  | { mode: "bisector"; lineA: SketchEntityRef; lineB: SketchEntityRef; near?: SketchPoint; length?: number; infinite?: boolean; centerline?: boolean }
  | { mode: "tangent-at"; circle: SketchEntityRef; angleDegrees: number; length?: number; infinite?: boolean; centerline?: boolean }
  | { mode: "tangent-external"; circle: SketchEntityRef; through: SketchPoint; near?: SketchPoint; length?: number; infinite?: boolean; centerline?: boolean }
  | { mode: "tangent-two"; circleA: SketchEntityRef; circleB: SketchEntityRef; internal?: boolean; near?: SketchPoint; length?: number; infinite?: boolean; centerline?: boolean };

function segmentFromDir(center: SketchPoint, dir: SketchPoint, length: number): [SketchPoint, SketchPoint] {
  const half = length / 2;
  return [
    [center[0] - dir[0] * half, center[1] - dir[1] * half],
    [center[0] + dir[0] * half, center[1] + dir[1] * half],
  ];
}

function linePointDistance(p: SketchPoint, a: SketchPoint, b: SketchPoint): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  if (len < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / len;
}

/** Analytic construction-line generator (SolidCraft's `sketch.construction_line.*` suite). */
export function createConstructionLine(
  source: SketchDrawing,
  request: ConstructionLineRequest,
): { drawing: SketchDrawing; contourIndex: number } {
  const next = structuredClone(source);
  const length = request.mode === "free" ? undefined : (request.length ?? 40);
  if (length !== undefined && (!Number.isFinite(length) || length <= 0))
    throw new Error("Construction line length must be positive.");
  let start: SketchPoint;
  let end: SketchPoint;

  switch (request.mode) {
    case "free":
      start = [...request.start];
      end = [...request.end];
      break;
    case "horizontal":
      [start, end] = segmentFromDir(request.through, [1, 0], length!);
      break;
    case "vertical":
      [start, end] = segmentFromDir(request.through, [0, 1], length!);
      break;
    case "angle": {
      const rad = (request.angleDegrees * Math.PI) / 180;
      [start, end] = segmentFromDir(request.through, [Math.cos(rad), Math.sin(rad)], length!);
      break;
    }
    case "parallel": {
      const l = resolve(next, request.line).line;
      if (!l) throw new Error("Parallel construction line requires a line reference.");
      const dx = l[1][0] - l[0][0], dy = l[1][1] - l[0][1], len = Math.hypot(dx, dy);
      if (len < 1e-10) throw new Error("Reference line has zero length.");
      const u: SketchPoint = [dx / len, dy / len];
      const n: SketchPoint = [-u[1], u[0]];
      const center: SketchPoint = request.through
        ? [...request.through]
        : [(l[0][0] + l[1][0]) / 2 + n[0] * (request.offsetMillimeters ?? 10), (l[0][1] + l[1][1]) / 2 + n[1] * (request.offsetMillimeters ?? 10)];
      [start, end] = segmentFromDir(center, u, request.length ?? len);
      break;
    }
    case "perpendicular": {
      const l = resolve(next, request.line).line;
      if (!l) throw new Error("Perpendicular construction line requires a line reference.");
      const dx = l[1][0] - l[0][0], dy = l[1][1] - l[0][1], len = Math.hypot(dx, dy);
      if (len < 1e-10) throw new Error("Reference line has zero length.");
      [start, end] = segmentFromDir(request.through, [-dy / len, dx / len], length!);
      break;
    }
    case "bisector": {
      const la = resolve(next, request.lineA).line, lb = resolve(next, request.lineB).line;
      if (!la || !lb) throw new Error("Angle bisector requires two lines.");
      const da: SketchPoint = [la[1][0] - la[0][0], la[1][1] - la[0][1]];
      const db: SketchPoint = [lb[1][0] - lb[0][0], lb[1][1] - lb[0][1]];
      const lenA = Math.hypot(...da), lenB = Math.hypot(...db);
      if (lenA < 1e-10 || lenB < 1e-10) throw new Error("Reference lines must have positive length.");
      const ua: SketchPoint = [da[0] / lenA, da[1] / lenA];
      const ub: SketchPoint = [db[0] / lenB, db[1] / lenB];
      const cross = ua[0] * ub[1] - ua[1] * ub[0];
      if (Math.abs(cross) < 1e-9) {
        // Parallel lines: midline halfway between them.
        const mid: SketchPoint = [(la[0][0] + la[1][0] + lb[0][0] + lb[1][0]) / 4, (la[0][1] + la[1][1] + lb[0][1] + lb[1][1]) / 4];
        [start, end] = segmentFromDir(mid, ua, length!);
      } else {
        const t = ((lb[0][0] - la[0][0]) * ub[1] - (lb[0][1] - la[0][1]) * ub[0]) / cross;
        const inter: SketchPoint = [la[0][0] + t * ua[0], la[0][1] + t * ua[1]];
        const sum: SketchPoint = [ua[0] + ub[0], ua[1] + ub[1]];
        const diff: SketchPoint = [ua[0] - ub[0], ua[1] - ub[1]];
        const norm = (v: SketchPoint): SketchPoint => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l]; };
        const d1 = norm(sum), d2 = norm(diff);
        const c1 = segmentFromDir(inter, d1, length!);
        const c2 = segmentFromDir(inter, d2, length!);
        if (request.near && linePointDistance(request.near, c2[0], c2[1]) < linePointDistance(request.near, c1[0], c1[1])) {
          [start, end] = c2;
        } else {
          [start, end] = c1;
        }
      }
      break;
    }
    case "tangent-at": {
      const c = resolve(next, request.circle).circle;
      if (!c) throw new Error("Tangent construction line requires a circle or arc.");
      const rad = (request.angleDegrees * Math.PI) / 180;
      const pt: SketchPoint = [c.center[0] + c.radius * Math.cos(rad), c.center[1] + c.radius * Math.sin(rad)];
      [start, end] = segmentFromDir(pt, [-Math.sin(rad), Math.cos(rad)], length!);
      break;
    }
    case "tangent-external": {
      const c = resolve(next, request.circle).circle;
      if (!c) throw new Error("External tangent requires a circle or arc.");
      const dx = request.through[0] - c.center[0], dy = request.through[1] - c.center[1];
      const dist = Math.hypot(dx, dy);
      if (dist <= c.radius + 1e-8) throw new Error("Point must lie outside the circle.");
      const baseAngle = Math.atan2(dy, dx);
      const offset = Math.acos(c.radius / dist);
      const candidates: [SketchPoint, SketchPoint][] = [baseAngle + offset, baseAngle - offset].map((ang) => [
        [...request.through] as SketchPoint,
        [c.center[0] + c.radius * Math.cos(ang), c.center[1] + c.radius * Math.sin(ang)] as SketchPoint,
      ]);
      const chosen = request.near && linePointDistance(request.near, candidates[1][0], candidates[1][1]) < linePointDistance(request.near, candidates[0][0], candidates[0][1])
        ? candidates[1]
        : candidates[0];
      [start, end] = chosen;
      break;
    }
    case "tangent-two": {
      const ca = resolve(next, request.circleA).circle, cb = resolve(next, request.circleB).circle;
      if (!ca || !cb) throw new Error("Common tangent requires two circles or arcs.");
      const dx = cb.center[0] - ca.center[0], dy = cb.center[1] - ca.center[1];
      const dist = Math.hypot(dx, dy);
      const rDiff = request.internal ? ca.radius + cb.radius : ca.radius - cb.radius;
      if (dist <= Math.abs(rDiff) + 1e-8) throw new Error("No common tangent exists for these circles.");
      const baseAngle = Math.atan2(dy, dx);
      const alpha = Math.acos(rDiff / dist);
      const candidates: [SketchPoint, SketchPoint][] = [1, -1].map((s) => {
        const thetaA = baseAngle + s * alpha;
        const thetaB = request.internal ? thetaA + Math.PI : thetaA;
        return [
          [ca.center[0] + ca.radius * Math.cos(thetaA), ca.center[1] + ca.radius * Math.sin(thetaA)] as SketchPoint,
          [cb.center[0] + cb.radius * Math.cos(thetaB), cb.center[1] + cb.radius * Math.sin(thetaB)] as SketchPoint,
        ];
      });
      const chosen = request.near && linePointDistance(request.near, candidates[1][0], candidates[1][1]) < linePointDistance(request.near, candidates[0][0], candidates[0][1])
        ? candidates[1]
        : candidates[0];
      [start, end] = chosen;
      break;
    }
  }

  const contourIndex = next.contours.length;
  next.contours.push({
    type: "path",
    start,
    segments: [{ type: "line", end }],
    construction: true,
    ...(request.infinite ? { infinite: true } : {}),
    ...(request.centerline ? { centerline: true } : {}),
  });
  validateSketchDrawing(next);
  return { drawing: next, contourIndex };
}
