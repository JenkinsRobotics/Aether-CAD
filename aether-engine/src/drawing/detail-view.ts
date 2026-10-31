/** Detail views reuse the parent's projection clipped to a circle. Lines are clipped
 *  analytically; circles, arcs and polylines that cross the circle become display
 *  polylines at the drawing's 0.01 mm chord tolerance. */
import type { DrawingPoint } from "./document";
import type { PartDrawingProjection, ProjectedDrawingCurve } from "./projection";

const TOLERANCE_MM = 0.01;

function clipSegment(a: DrawingPoint, b: DrawingPoint, c: DrawingPoint, r: number): [DrawingPoint, DrawingPoint] | null {
  const d: DrawingPoint = [b[0] - a[0], b[1] - a[1]], f: DrawingPoint = [a[0] - c[0], a[1] - c[1]];
  const A = d[0] ** 2 + d[1] ** 2, B = 2 * (f[0] * d[0] + f[1] * d[1]), C = f[0] ** 2 + f[1] ** 2 - r * r;
  if (A < 1e-18) return C <= 0 ? [a, b] : null;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const s = Math.sqrt(disc), t0 = Math.max(0, (-B - s) / (2 * A)), t1 = Math.min(1, (-B + s) / (2 * A));
  if (t1 - t0 < 1e-9) return null;
  const at = (t: number): DrawingPoint => [a[0] + d[0] * t, a[1] + d[1] * t];
  return [at(t0), at(t1)];
}

function samples(curve: Extract<ProjectedDrawingCurve, { kind: "circle" | "arc" }>): DrawingPoint[] {
  const start = curve.kind === "circle" ? 0 : curve.start;
  let sweep = curve.kind === "circle" ? 2 * Math.PI : ((curve.ccw ? curve.end - curve.start : curve.start - curve.end) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
  const sign = curve.kind === "arc" && !curve.ccw ? -1 : 1;
  const step = 2 * Math.acos(Math.max(-1, 1 - TOLERANCE_MM / curve.radius)), count = Math.max(8, Math.ceil(sweep / step));
  const points: DrawingPoint[] = [];
  for (let i = 0; i <= count; i++) { const angle = start + sign * sweep * i / count; points.push([curve.center[0] + curve.radius * Math.cos(angle), curve.center[1] + curve.radius * Math.sin(angle)]); }
  return points;
}

/** Clips every curve to the circle; polylines split into runs where they leave it. */
export function clipProjectionToCircle(geometry: PartDrawingProjection, center: DrawingPoint, radius: number): PartDrawingProjection {
  const inside = (p: DrawingPoint) => Math.hypot(p[0] - center[0], p[1] - center[1]) <= radius + 1e-9;
  const clipPolyline = (points: DrawingPoint[], toleranceMm: number): ProjectedDrawingCurve[] => {
    const out: ProjectedDrawingCurve[] = [];
    let run: DrawingPoint[] = [];
    for (let i = 1; i < points.length; i++) {
      const piece = clipSegment(points[i - 1], points[i], center, radius);
      if (!piece) { if (run.length > 1) out.push({ kind: "polyline", points: run, toleranceMm }); run = []; continue; }
      if (!run.length || Math.hypot(piece[0][0] - run.at(-1)![0], piece[0][1] - run.at(-1)![1]) > 1e-9) { if (run.length > 1) out.push({ kind: "polyline", points: run, toleranceMm }); run = [piece[0]]; }
      run.push(piece[1]);
    }
    if (run.length > 1) out.push({ kind: "polyline", points: run, toleranceMm });
    return out;
  };
  const clip = (curves: ProjectedDrawingCurve[]): ProjectedDrawingCurve[] => curves.flatMap(curve => {
    if (curve.kind === "line") { const piece = clipSegment(curve.start, curve.end, center, radius); return piece ? [{ kind: "line", start: piece[0], end: piece[1] }] : []; }
    if (curve.kind === "polyline") return clipPolyline(curve.points, curve.toleranceMm);
    const sampled = samples(curve);
    return sampled.every(inside) ? [curve] : clipPolyline(sampled, TOLERANCE_MM);
  });
  const hatch = geometry.hatch ? clip(geometry.hatch).filter((c): c is Extract<ProjectedDrawingCurve, { kind: "line" }> => c.kind === "line") : undefined;
  return { visible: clip(geometry.visible), hidden: clip(geometry.hidden), bodyIds: geometry.bodyIds, bounds: [center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius], ...(hatch ? { hatch } : {}) };
}

/** Sheet-mm chords of a circle. ponytail: annotation graphics are line lists; a circle primitive would need every exporter to grow. */
export function circleChords(center: DrawingPoint, radius: number, count = 32): [DrawingPoint, DrawingPoint][] {
  const at = (i: number): DrawingPoint => [center[0] + radius * Math.cos(2 * Math.PI * i / count), center[1] + radius * Math.sin(2 * Math.PI * i / count)];
  return Array.from({ length: count }, (_, i) => [at(i), at(i + 1)]);
}
