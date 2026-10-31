import { contourClosed, validateSketchDrawing, type SketchDrawing, type SketchPoint, type SketchSegment } from "../drawing";
import type { SketchEntityRef } from "../solver/types";
import { resolveSegmentReference, identifySegmentReference } from "../solver/segment-reference";
import { segmentPoint } from "../curves/parameterization";
import { assertConstraintsSatisfied } from "./preserve-constraints";

/** Remove a spline point (FreeCAD's knot removal): the two cubic spans meeting at the picked
 *  path vertex become one cubic that keeps both outer end tangents and fits the old curve by
 *  least squares. Exact when the spans came from one cubic (an inserted point); otherwise the
 *  curve moves slightly, as knot removal does. The G2 relation an insert left at the vertex
 *  goes with it; any other constraint on the vertex or its two spans must be removed first. */
export function removeSketchSplinePoint(drawing: SketchDrawing, point: SketchPoint, tolerance: number): SketchDrawing {
  let target: { contour: number; vertex: number } | undefined, best = tolerance;
  drawing.contours.forEach((c, i) => {
    if (c.type !== "path" || contourClosed(c)) return;
    c.segments.slice(0, -1).forEach((s, j) => {
      const d = Math.hypot(s.end[0] - point[0], s.end[1] - point[1]);
      if (d < best && s.type === "bezier" && c.segments[j + 1].type === "bezier") { best = d; target = { contour: i, vertex: j + 1 }; }
    });
  });
  if (!target) throw Error("Select a point joining two cubic spline spans.");
  const { contour, vertex } = target;
  const source = drawing.contours[contour];
  if (source.type !== "path") throw Error("Select a path.");
  const normalize = (ref: SketchEntityRef) => (ref.contour === contour ? resolveSegmentReference(source, ref) : ref);
  const onJoin = (ref: SketchEntityRef) => {
    const r = normalize(ref);
    if (r.contour !== contour || r.kind === "contour") return false;
    if (r.kind === "point" && r.control === undefined) return r.index === vertex;
    return r.index === vertex - 1 || r.index === vertex;
  };
  const next = structuredClone(drawing), c = next.contours[contour];
  if (c.type !== "path") throw Error("Select a path.");
  const constraints = next.constraints ?? [];
  // The smoothness relation an insert left between the two spans at this vertex (or on the vertex itself).
  const atJoinEnd = (r: SketchEntityRef | undefined) => { if (!r) return false; const n = normalize(r); return n.contour === contour && ((n.kind === "point" && n.control === undefined && n.index === vertex) || (n.kind === "curve" && ((n.index === vertex - 1 && n.parameter === 1) || (n.index === vertex && n.parameter === 0)))); };
  const dropped = new Set(constraints.filter((k) => (k.kind === "curvature" || k.kind === "tangent") && atJoinEnd(k.a) && atJoinEnd(k.b)).map((k) => k.id));
  if (constraints.some((k) => !dropped.has(k.id) && [k.a, k.b, k.axis].some((r) => r && onJoin(r)))) throw Error("Remove dimensions and relations on the point and its two spans first. No geometry was changed.");
  const first = c.segments[vertex - 1], second = c.segments[vertex];
  if (first.type !== "bezier" || second.type !== "bezier") throw Error("Select a point joining two cubic spline spans.");
  const start = vertex === 1 ? c.start : c.segments[vertex - 2].end;
  c.segments.splice(vertex - 1, 2, { ...(first.id !== undefined ? { id: first.id } : {}), ...(second.endVertexId !== undefined ? { endVertexId: second.endVertexId } : {}), ...mergeCubics(start, first, second) });
  const remap = (ref: SketchEntityRef): SketchEntityRef => {
    const r = normalize(ref);
    if (r.contour !== contour || r.kind === "contour" || r.index === undefined || r.index <= vertex) return r;
    const { segmentId: _s, vertexId: _v, ...local } = { ...r, index: r.index - 1 };
    return identifySegmentReference(c, local);
  };
  next.constraints = constraints.filter((k) => !dropped.has(k.id)).map((k) => ({ ...k, a: remap(k.a), ...(k.b ? { b: remap(k.b) } : {}), ...(k.axis ? { axis: remap(k.axis) } : {}) }));
  if (!next.constraints.length) delete next.constraints;
  assertConstraintsSatisfied(next);
  validateSketchDrawing(next);
  return next;
}

/** One cubic through both spans' outer ends with their outer tangent directions; the tangent
 *  lengths are the least-squares fit to 32 points of the old curve on a chord-length parameter. */
export function mergeCubics(start: SketchPoint, first: Extract<SketchSegment, { type: "bezier" }>, second: Extract<SketchSegment, { type: "bezier" }>): Extract<SketchSegment, { type: "bezier" }> {
  const p0 = start, p3 = second.end;
  const exact = unsplitCubic(start, first, second);
  if (exact) return exact;
  const unit = (v: SketchPoint, fallback: SketchPoint): SketchPoint => { const n = Math.hypot(v[0], v[1]); return n < 1e-9 ? fallback : [v[0] / n, v[1] / n]; };
  const chord: SketchPoint = [p3[0] - p0[0], p3[1] - p0[1]];
  const t0 = unit([first.controls[0][0] - p0[0], first.controls[0][1] - p0[1]], unit(chord, [1, 0]));
  const t1 = unit([p3[0] - second.controls[1][0], p3[1] - second.controls[1][1]], unit(chord, [1, 0]));
  const samples: SketchPoint[] = [];
  for (let k = 0; k <= 16; k++) samples.push(segmentPoint(p0, first, k / 16));
  for (let k = 1; k <= 16; k++) samples.push(segmentPoint(first.end, second, k / 16));
  const lengths = [0]; for (let k = 1; k < samples.length; k++) lengths.push(lengths[k - 1] + Math.hypot(samples[k][0] - samples[k - 1][0], samples[k][1] - samples[k - 1][1]));
  const total = lengths[lengths.length - 1] || 1;
  // Residual r = S − base(u) = α·a(u) + β·b(u) with a = 3(1−u)²u·t0, b = −3(1−u)u²·t1; normal equations in α, β.
  let aa = 0, ab = 0, bb = 0, ar = 0, br = 0;
  samples.forEach((s, k) => {
    const u = lengths[k] / total, w0 = (1 - u) ** 3 + 3 * (1 - u) ** 2 * u, w3 = u ** 3 + 3 * (1 - u) * u ** 2, fa = 3 * (1 - u) ** 2 * u, fb = -3 * (1 - u) * u ** 2;
    for (const axis of [0, 1] as const) {
      const r = s[axis] - w0 * p0[axis] - w3 * p3[axis], a = fa * t0[axis], b = fb * t1[axis];
      aa += a * a; ab += a * b; bb += b * b; ar += a * r; br += b * r;
    }
  });
  const det = aa * bb - ab * ab;
  let alpha = det > 1e-12 ? (ar * bb - br * ab) / det : NaN, beta = det > 1e-12 ? (br * aa - ar * ab) / det : NaN;
  const span = Math.hypot(chord[0], chord[1]) / 3;
  if (!(alpha > 0)) alpha = span; if (!(beta > 0)) beta = span;
  return { type: "bezier", controls: [[p0[0] + alpha * t0[0], p0[1] + alpha * t0[1]], [p3[0] - beta * t1[0], p3[1] - beta * t1[1]]], end: [...p3] as SketchPoint };
}


/** The cubic the two spans were cut from by de Casteljau subdivision, when they were (the join
 *  lies on the line between the inner controls at the split parameter and both spans reproduce). */
function unsplitCubic(start: SketchPoint, first: Extract<SketchSegment, { type: "bezier" }>, second: Extract<SketchSegment, { type: "bezier" }>): Extract<SketchSegment, { type: "bezier" }> | undefined {
  const j = first.end, m0 = first.controls[1], m1 = second.controls[0];
  const span = Math.hypot(m1[0] - m0[0], m1[1] - m0[1]);
  if (span < 1e-9) return undefined;
  const t = Math.hypot(j[0] - m0[0], j[1] - m0[1]) / span;
  if (!(t > 1e-6 && t < 1 - 1e-6)) return undefined;
  const c0: SketchPoint = [start[0] + (first.controls[0][0] - start[0]) / t, start[1] + (first.controls[0][1] - start[1]) / t];
  const c1: SketchPoint = [second.end[0] + (second.controls[1][0] - second.end[0]) / (1 - t), second.end[1] + (second.controls[1][1] - second.end[1]) / (1 - t)];
  const whole: Extract<SketchSegment, { type: "bezier" }> = { type: "bezier", controls: [c0, c1], end: [...second.end] as SketchPoint };
  for (let k = 0; k <= 8; k++) {
    const u = k / 8, p = segmentPoint(start, whole, t * u), q = segmentPoint(start, first, u), r = segmentPoint(start, whole, t + (1 - t) * u), s = segmentPoint(j, second, u);
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6 || Math.hypot(r[0] - s[0], r[1] - s[1]) > 1e-6) return undefined;
  }
  return whole;
}
