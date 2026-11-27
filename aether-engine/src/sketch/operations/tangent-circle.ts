import { validateSketchDrawing, type SketchContour, type SketchDrawing, type SketchPoint } from "../drawing";
import type { SketchEntityRef } from "../solver/types";
import { resolve } from "../solver/entities";

/** Create a circle defined by two diameter endpoints (`sketch.circle.two_point`). */
export function createTwoPointCircle(p0: SketchPoint, p1: SketchPoint, construction = false): SketchContour {
  const radius = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 2;
  if (!Number.isFinite(radius) || radius < 1e-8) throw new Error("Diameter endpoints must be distinct.");
  return {
    type: "circle",
    center: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2],
    radius,
    ...(construction ? { construction: true } : {}),
  };
}

/** Create a 2-point rectangle with four equal corner fillet arcs (`sketch.rectangle.rounded`). */
export function createRoundedRectangle(
  p0: SketchPoint,
  p1: SketchPoint,
  radius: number,
  construction = false,
): SketchContour {
  const x0 = Math.min(p0[0], p1[0]), x1 = Math.max(p0[0], p1[0]);
  const y0 = Math.min(p0[1], p1[1]), y1 = Math.max(p0[1], p1[1]);
  const w = x1 - x0, h = y1 - y0;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1e-6 || h < 1e-6)
    throw new Error("Rounded rectangle needs positive width and height.");
  if (!Number.isFinite(radius) || radius <= 0 || radius >= Math.min(w, h) / 2 - 1e-6)
    throw new Error("Corner radius must be positive and less than half the shorter side.");
  const k = Math.SQRT1_2;
  const r = radius;
  const cBR: SketchPoint = [x1 - r, y0 + r];
  const cTR: SketchPoint = [x1 - r, y1 - r];
  const cTL: SketchPoint = [x0 + r, y1 - r];
  const cBL: SketchPoint = [x0 + r, y0 + r];
  return {
    type: "path",
    start: [x0 + r, y0],
    segments: [
      { type: "line", end: [x1 - r, y0] },
      { type: "arc", middle: [cBR[0] + r * k, cBR[1] - r * k], end: [x1, y0 + r] },
      { type: "line", end: [x1, y1 - r] },
      { type: "arc", middle: [cTR[0] + r * k, cTR[1] + r * k], end: [x1 - r, y1] },
      { type: "line", end: [x0 + r, y1] },
      { type: "arc", middle: [cTL[0] - r * k, cTL[1] + r * k], end: [x0, y1 - r] },
      { type: "line", end: [x0, y0 + r] },
      { type: "arc", middle: [cBL[0] - r * k, cBL[1] - r * k], end: [x0 + r, y0] },
    ],
    ...(construction ? { construction: true } : {}),
  };
}

type LineOrCircle =
  | { kind: "line"; a: SketchPoint; u: SketchPoint; n: SketchPoint }
  | { kind: "circle"; c: SketchPoint; r: number };

function extractCurve(d: SketchDrawing, ref: SketchEntityRef): LineOrCircle {
  const e = resolve(d, ref);
  if (e.line) {
    const dx = e.line[1][0] - e.line[0][0], dy = e.line[1][1] - e.line[0][1], len = Math.hypot(dx, dy);
    if (len < 1e-10) throw new Error("Reference line has zero length.");
    const u: SketchPoint = [dx / len, dy / len];
    return { kind: "line", a: e.line[0], u, n: [-u[1], u[0]] };
  }
  if (e.circle) return { kind: "circle", c: e.circle.center, r: e.circle.radius };
  throw new Error("Tangent circle requires lines, circles, or arcs.");
}

function intersectLines(a: SketchPoint, ua: SketchPoint, b: SketchPoint, ub: SketchPoint): SketchPoint | null {
  const det = ua[0] * ub[1] - ua[1] * ub[0];
  if (Math.abs(det) < 1e-10) return null;
  const t = ((b[0] - a[0]) * ub[1] - (b[1] - a[1]) * ub[0]) / det;
  return [a[0] + t * ua[0], a[1] + t * ua[1]];
}

function intersectLineCircle(a: SketchPoint, u: SketchPoint, c: SketchPoint, r: number): SketchPoint[] {
  const ox = a[0] - c[0], oy = a[1] - c[1];
  const b = 2 * (ox * u[0] + oy * u[1]);
  const cc = ox * ox + oy * oy - r * r;
  const disc = b * b - 4 * cc;
  if (disc < -1e-9) return [];
  const s = Math.sqrt(Math.max(0, disc));
  const ts = disc < 1e-9 ? [-b / 2] : [(-b - s) / 2, (-b + s) / 2];
  return ts.map((t) => [a[0] + t * u[0], a[1] + t * u[1]]);
}

function intersectCircles(c1: SketchPoint, r1: number, c2: SketchPoint, r2: number): SketchPoint[] {
  const dx = c2[0] - c1[0], dy = c2[1] - c1[1], d = Math.hypot(dx, dy);
  if (d < 1e-9 || d > r1 + r2 + 1e-7 || d < Math.abs(r1 - r2) - 1e-7) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = Math.max(0, r1 * r1 - a * a);
  const h = Math.sqrt(h2);
  const xm = c1[0] + (a * dx) / d, ym = c1[1] + (a * dy) / d;
  if (h < 1e-8) return [[xm, ym]];
  const rx = (-dy * h) / d, ry = (dx * h) / d;
  return [[xm + rx, ym + ry], [xm - rx, ym - ry]];
}

/** Create a circle of given `radius` tangent to two lines/circles/arcs (`sketch.circle.two_tangent`). */
export function createTwoTangentCircle(
  source: SketchDrawing,
  refA: SketchEntityRef,
  refB: SketchEntityRef,
  radius: number,
  near: SketchPoint,
  construction = false,
): { drawing: SketchDrawing; contourIndex: number } {
  if (!Number.isFinite(radius) || radius <= 0) throw new Error("Radius must be positive.");
  const next = structuredClone(source);
  const A = extractCurve(next, refA);
  const B = extractCurve(next, refB);
  const centers: SketchPoint[] = [];

  if (A.kind === "line" && B.kind === "line") {
    for (const sa of [-1, 1]) {
      for (const sb of [-1, 1]) {
        const pa: SketchPoint = [A.a[0] + sa * radius * A.n[0], A.a[1] + sa * radius * A.n[1]];
        const pb: SketchPoint = [B.a[0] + sb * radius * B.n[0], B.a[1] + sb * radius * B.n[1]];
        const p = intersectLines(pa, A.u, pb, B.u);
        if (p) centers.push(p);
      }
    }
  } else if (A.kind === "line" && B.kind === "circle") {
    for (const sa of [-1, 1]) {
      const pa: SketchPoint = [A.a[0] + sa * radius * A.n[0], A.a[1] + sa * radius * A.n[1]];
      for (const rb of [B.r + radius, Math.abs(B.r - radius)]) {
        if (rb > 1e-8) centers.push(...intersectLineCircle(pa, A.u, B.c, rb));
      }
    }
  } else if (A.kind === "circle" && B.kind === "line") {
    for (const sb of [-1, 1]) {
      const pb: SketchPoint = [B.a[0] + sb * radius * B.n[0], B.a[1] + sb * radius * B.n[1]];
      for (const ra of [A.r + radius, Math.abs(A.r - radius)]) {
        if (ra > 1e-8) centers.push(...intersectLineCircle(pb, B.u, A.c, ra));
      }
    }
  } else if (A.kind === "circle" && B.kind === "circle") {
    for (const ra of [A.r + radius, Math.abs(A.r - radius)]) {
      for (const rb of [B.r + radius, Math.abs(B.r - radius)]) {
        if (ra > 1e-8 && rb > 1e-8) centers.push(...intersectCircles(A.c, ra, B.c, rb));
      }
    }
  }
  if (!centers.length) throw new Error("No tangent circle of that radius exists for the selected curves.");
  centers.sort((p, q) => Math.hypot(p[0] - near[0], p[1] - near[1]) - Math.hypot(q[0] - near[0], q[1] - near[1]));
  const contourIndex = next.contours.length;
  next.contours.push({ type: "circle", center: centers[0], radius, ...(construction ? { construction: true } : {}) });
  validateSketchDrawing(next);
  return { drawing: next, contourIndex };
}

/** Create a circle tangent to three lines (`sketch.circle.three_tangent`: incircle / excircles). */
export function createThreeTangentCircle(
  source: SketchDrawing,
  refs: [SketchEntityRef, SketchEntityRef, SketchEntityRef],
  near: SketchPoint,
  construction = false,
): { drawing: SketchDrawing; contourIndex: number } {
  const next = structuredClone(source);
  const curves = refs.map((r) => extractCurve(next, r));
  if (!curves.every((c): c is Extract<LineOrCircle, { kind: "line" }> => c.kind === "line")) {
    throw new Error("Three-tangent circle currently requires three non-parallel lines.");
  }
  const [L0, L1, L2] = curves;
  const v01 = intersectLines(L0.a, L0.u, L1.a, L1.u);
  const v12 = intersectLines(L1.a, L1.u, L2.a, L2.u);
  const v20 = intersectLines(L2.a, L2.u, L0.a, L0.u);
  if (!v01 || !v12 || !v20) throw new Error("Three lines must form a non-degenerate triangle.");
  const a = Math.hypot(v12[0] - v20[0], v12[1] - v20[1]); // opposite v01
  const b = Math.hypot(v20[0] - v01[0], v20[1] - v01[1]); // opposite v12
  const c = Math.hypot(v01[0] - v12[0], v01[1] - v12[1]); // opposite v20
  const area2 = Math.abs((v12[0] - v01[0]) * (v20[1] - v01[1]) - (v12[1] - v01[1]) * (v20[0] - v01[0]));
  if (area2 < 1e-8) throw new Error("Three lines are concurrent or degenerate.");
  // Incircle + 3 excircles via barycentric weights (±a, ±b, ±c).
  const combos: [number, number, number][] = [[a, b, c], [-a, b, c], [a, -b, c], [a, b, -c]];
  const candidates = combos
    .map(([wa, wb, wc]) => {
      const s = wa + wb + wc;
      if (Math.abs(s) < 1e-9) return null;
      const center: SketchPoint = [
        (wa * v01[0] + wb * v12[0] + wc * v20[0]) / s,
        (wa * v01[1] + wb * v12[1] + wc * v20[1]) / s,
      ];
      const radius = area2 / Math.abs(s);
      return { center, radius };
    })
    .filter((item): item is { center: SketchPoint; radius: number } => Boolean(item && item.radius > 1e-8));
  candidates.sort(
    (p, q) => Math.hypot(p.center[0] - near[0], p.center[1] - near[1]) - Math.hypot(q.center[0] - near[0], q.center[1] - near[1]),
  );
  const best = candidates[0];
  if (!best) throw new Error("Could not construct a circle tangent to the three lines.");
  const contourIndex = next.contours.length;
  next.contours.push({ type: "circle", center: best.center, radius: best.radius, ...(construction ? { construction: true } : {}) });
  validateSketchDrawing(next);
  return { drawing: next, contourIndex };
}
