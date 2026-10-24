import { cast, getOC, type AnyShape, type Edge, type Shape3D } from "replicad";
import type { PartDocument } from "../document/index";
import type { SketchContour, SketchFrame, SketchPoint, SketchSegment } from "../sketch/drawing";
import { evaluatePartDocument } from "./part-evaluator";

/** fit: the section, with mesh bodies cut too and fitted as lines and arcs (Fit Curves to Section). */
export type SketchSectionKind = "section" | "edges" | "fit" | "spun";
type V3 = [number, number, number];
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** SolidCraft's Intersect and Include 3D Geometry: the curves where the sketch plane
 *  cuts the document's bodies (`section`), or the body edges lying in that plane
 *  (`edges`), as exact sketch contours in the frame's coordinates. Lines, circles and
 *  circular arcs stay exact; other curves are sampled into short lines. */
export function sketchSectionContours(document: PartDocument, frame: SketchFrame, kind: SketchSectionKind, axis?: [SketchPoint, SketchPoint]): SketchContour[] {
  if (kind === "spun") {
    if (!axis) throw new Error("Spun profile needs an axis: select a line of the sketch.");
    let result: SketchContour[] = [];
    let meshes: { vertices: ArrayLike<number>; triangles: ArrayLike<number> }[] = [];
    evaluatePartDocument(document, { withMeshes: (m) => { meshes = [...m.values()]; }, withBodies: (bodies) => { result = spunProfileContours(bodies.values() as Iterable<Shape3D>, meshes, frame, axis); } });
    return result;
  }
  const o = frame.originMillimeters as V3, x = frame.xDirection as V3, n = frame.normal as V3, y = cross(n, x);
  const to2D = (p: { x: number; y: number; z: number }): SketchPoint => { const d = sub([p.x, p.y, p.z], o); return [round(dot(d, x)), round(dot(d, y))]; };
  const inPlane = (p: { x: number; y: number; z: number }) => Math.abs(dot(sub([p.x, p.y, p.z], o), n)) < 1e-6;
  const contours: SketchContour[] = [];
  const owned: AnyShape[] = [];
  const own = <T extends AnyShape>(shape: T): T => { owned.push(shape); return shape; };
  const convert = (edge: Edge) => {
    const start = edge.startPoint, end = edge.endPoint, mid = edge.pointAt(0.5);
    try {
      const a = to2D(start), b = to2D(end), m = to2D(mid);
      const closed = Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7;
      if (edge.geomType === "LINE") { if (!closed) contours.push({ type: "path", start: a, segments: [{ type: "line", end: b }] }); return; }
      if (edge.geomType === "CIRCLE") {
        if (closed) { const q = edge.pointAt(0.25); try { const c = to2D(q); const center: SketchPoint = [(a[0] + m[0]) / 2, (a[1] + m[1]) / 2]; contours.push({ type: "circle", center, radius: round(Math.hypot(c[0] - center[0], c[1] - center[1])) }); } finally { q.delete(); } }
        else contours.push({ type: "path", start: a, segments: [{ type: "arc", middle: m, end: b }] });
        return;
      }
      const samples = 32, points: SketchPoint[] = [];
      for (let i = 0; i <= samples; i++) { const p = edge.pointAt(i / samples); try { points.push(to2D(p)); } finally { p.delete(); } }
      contours.push({ type: "path", start: points[0], segments: points.slice(1).map((end) => ({ type: "line" as const, end })) });
    } finally { start.delete(); end.delete(); mid.delete(); }
  };
  evaluatePartDocument(document, { withMeshes: (meshes) => { if (kind === "fit") for (const mesh of meshes.values()) for (const polyline of meshSectionPolylines(mesh, frame)) if (polyline.length > 1) contours.push(...fitLinesAndArcs(polyline)); }, withBodies: (bodies) => {
    try {
      for (const body of bodies.values()) {
        if (kind === "edges") {
          for (const edge of (body as Shape3D).edges) { const s = edge.startPoint, e = edge.endPoint, m = edge.pointAt(0.5); try { if (inPlane(s) && inPlane(e) && inPlane(m)) convert(edge); } finally { s.delete(); e.delete(); m.delete(); edge.delete(); } }
          continue;
        }
        const oc = getOC();
        const origin = new oc.gp_Pnt_3(o[0], o[1], o[2]), direction = new oc.gp_Dir_4(n[0], n[1], n[2]), plane = new oc.gp_Pln_3(origin, direction);
        const section = new oc.BRepAlgoAPI_Section_1(), progress = new oc.Message_ProgressRange_1();
        try {
          section.Init1_1((body as Shape3D).wrapped); section.Init2_2(plane); section.Build(progress);
          if (!section.IsDone()) continue;
          const result = own(cast(section.Shape()));
          for (const edge of (result as Shape3D).edges) { try { convert(edge); } finally { edge.delete(); } }
        } finally { section.delete(); progress.delete(); plane.delete(); direction.delete(); origin.delete(); }
      }
    } finally { owned.forEach((shape) => shape.delete()); }
  } });
  return contours;
}

function round(v: number): number { const r = Math.round(v * 1e7) / 1e7; return r === 0 ? 0 : r; }

/** A mesh cut by a plane: crossing segments of its triangles, chained into polylines in the
 *  frame's 2D coordinates. Vertices on the plane count as above it, so a crossing is never
 *  counted twice. */
export function meshSectionPolylines(mesh: { vertices: ArrayLike<number>; triangles: ArrayLike<number> }, frame: SketchFrame): SketchPoint[][] {
  const o = frame.originMillimeters as V3, x = frame.xDirection as V3, n = frame.normal as V3, y = cross(n, x);
  const v = (i: number): V3 => [mesh.vertices[3 * i], mesh.vertices[3 * i + 1], mesh.vertices[3 * i + 2]];
  const side = (p: V3) => dot(sub(p, o), n);
  const to2D = (p: V3): SketchPoint => { const d = sub(p, o); return [round(dot(d, x)), round(dot(d, y))]; };
  const segments: [SketchPoint, SketchPoint][] = [];
  for (let t = 0; t + 2 < mesh.triangles.length; t += 3) {
    const p = [v(mesh.triangles[t]), v(mesh.triangles[t + 1]), v(mesh.triangles[t + 2])], d = p.map(side);
    const hits: SketchPoint[] = [];
    for (let i = 0; i < 3; i++) {
      const a = d[i], b = d[(i + 1) % 3];
      if ((a >= 0) === (b >= 0)) continue;
      const s = a / (a - b), q = p[i], r = p[(i + 1) % 3];
      hits.push(to2D([q[0] + (r[0] - q[0]) * s, q[1] + (r[1] - q[1]) * s, q[2] + (r[2] - q[2]) * s]));
    }
    if (hits.length === 2 && Math.hypot(hits[0][0] - hits[1][0], hits[0][1] - hits[1][1]) > 1e-9) segments.push([hits[0], hits[1]]);
  }
  // Chain by shared end points (rounded keys; each crossing point is shared by two triangles).
  const key = (p: SketchPoint) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  const byPoint = new Map<string, number[]>();
  segments.forEach(([a, b], i) => { for (const k of [key(a), key(b)]) byPoint.set(k, [...(byPoint.get(k) ?? []), i]); });
  const used = new Set<number>(), chains: SketchPoint[][] = [];
  for (let start = 0; start < segments.length; start++) {
    if (used.has(start)) continue;
    used.add(start);
    const chain: SketchPoint[] = [...segments[start]];
    for (const forward of [true, false]) {
      for (;;) {
        const end = forward ? chain[chain.length - 1] : chain[0];
        const next = (byPoint.get(key(end)) ?? []).find((i) => !used.has(i));
        if (next === undefined) break;
        used.add(next);
        const [a, b] = segments[next], other = key(a) === key(end) ? b : a;
        if (forward) chain.push(other); else chain.unshift(other);
      }
    }
    chains.push(chain);
  }
  return chains;
}

/** Lines and arcs within `tolerance` of a polyline (SolidCraft's Fit Curves to Section). A
 *  closed run that is one circle becomes a circle; otherwise each stretch is a line if the
 *  points lie on it, an arc if they lie on the circle through its ends and middle, else it is
 *  split at the farthest point and fitted again. */
export function fitLinesAndArcs(points: SketchPoint[], tolerance = 0.05): SketchContour[] {
  const closed = points.length > 3 && Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1]) < 1e-6;
  const circleThrough = (a: SketchPoint, b: SketchPoint, c: SketchPoint) => {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if (Math.abs(d) < 1e-12) return undefined;
    const s = (p: SketchPoint) => p[0] * p[0] + p[1] * p[1];
    const center: SketchPoint = [(s(a) * (b[1] - c[1]) + s(b) * (c[1] - a[1]) + s(c) * (a[1] - b[1])) / d, (s(a) * (c[0] - b[0]) + s(b) * (a[0] - c[0]) + s(c) * (b[0] - a[0])) / d];
    return { center, radius: Math.hypot(a[0] - center[0], a[1] - center[1]) };
  };
  if (closed) {
    const ring = points.slice(0, -1), third = Math.floor(ring.length / 3);
    const c = circleThrough(ring[0], ring[third], ring[2 * third]);
    if (c && ring.every((p) => Math.abs(Math.hypot(p[0] - c.center[0], p[1] - c.center[1]) - c.radius) <= tolerance)) return [{ type: "circle", center: [round(c.center[0]), round(c.center[1])], radius: round(c.radius) }];
  }
  // Greedy: from each point, the longest run that one line or one arc holds within tolerance.
  const lineFits = (i: number, j: number) => {
    const a = points[i], b = points[j], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1e-12) return false;
    for (let k = i + 1; k < j; k++) { const p = points[k]; if (Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / length > tolerance) return false; }
    return true;
  };
  const arcFits = (i: number, j: number) => {
    if (j - i < 4) return false;
    const mid = Math.floor((i + j) / 2), c = circleThrough(points[i], points[mid], points[j]);
    if (!c || c.radius > 1e5) return false;
    const off = (p: SketchPoint) => Math.abs(Math.hypot(p[0] - c.center[0], p[1] - c.center[1]) - c.radius) > tolerance;
    for (let k = i; k <= j; k++) if (off(points[k])) return false;
    // Each segment's middle too, so an arc never cuts across a sharp corner between samples.
    for (let k = i; k < j; k++) if (off([(points[k][0] + points[k + 1][0]) / 2, (points[k][1] + points[k + 1][1]) / 2])) return false;
    return true;
  };
  const segments: SketchSegment[] = [];
  const last = points.length - 1;
  for (let i = 0; i < last; ) {
    let line = i + 1, arc = i;
    while (line < last && lineFits(i, line + 1)) line++;
    // ponytail: grows until the first misfit (a run can refit further on), so long sections stay quadratic.
    for (let j = i + 4; j <= last && arcFits(i, j); j++) arc = j;
    if (arc > line) { const mid = Math.floor((i + arc) / 2); segments.push({ type: "arc", middle: [...points[mid]] as SketchPoint, end: [...points[arc]] as SketchPoint }); i = arc; }
    else { segments.push({ type: "line", end: [...points[line]] as SketchPoint }); i = line; }
  }
  return [{ type: "path", start: [...points[0]] as SketchPoint, segments }];
}

/** Spun profile (SolidCraft's sketch.spun_profile): the bodies turned about an axis in the
 *  sketch plane, as their largest radius at each step along the axis, drawn on one side of
 *  the axis and closed along it, so revolving the result gives the bodies' turned envelope.
 *  Read from a fine tessellation (and mesh bodies' own triangles), then fitted with lines and
 *  arcs. The axis is two points in sketch coordinates. */
export function spunProfileContours(shapes: Iterable<Shape3D>, meshes: Iterable<{ vertices: ArrayLike<number>; triangles?: ArrayLike<number> }>, frame: SketchFrame, axis: [SketchPoint, SketchPoint], tolerance = 0.05): SketchContour[] {
  const o = frame.originMillimeters as V3, x = frame.xDirection as V3, n = frame.normal as V3, y = cross(n, x);
  const at = (p: SketchPoint): V3 => [o[0] + x[0] * p[0] + y[0] * p[1], o[1] + x[1] * p[0] + y[1] * p[1], o[2] + x[2] * p[0] + y[2] * p[1]];
  const a0 = at(axis[0]), dir3 = sub(at(axis[1]), a0), len = Math.hypot(...dir3);
  if (len < 1e-9) throw new Error("The spin axis needs two distinct points.");
  const u: V3 = [dir3[0] / len, dir3[1] / len, dir3[2] / len];
  const samples: [number, number][] = [];
  const add = (p: V3) => { const d = sub(p, a0), h = dot(d, u); samples.push([h, Math.hypot(d[0] - u[0] * h, d[1] - u[1] * h, d[2] - u[2] * h)]); };
  // Points along every triangle edge, not only the vertices: a cylinder's side has vertices
  // only on its end rings, but its edges run straight along the surface between them.
  const edges = (vertices: ArrayLike<number>, triangles: ArrayLike<number>) => {
    const v = (k: number): V3 => [vertices[3 * k], vertices[3 * k + 1], vertices[3 * k + 2]];
    for (let t = 0; t + 2 < triangles.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = v(triangles[t + e]), b = v(triangles[t + (e + 1) % 3]), steps = Math.min(200, Math.max(1, Math.ceil(Math.abs(dot(sub(b, a), u)) / tolerance)));
      for (let k = 0; k <= steps; k++) add([a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps, a[2] + (b[2] - a[2]) * k / steps]);
    }
  };
  for (const shape of shapes) { const m = shape.mesh({ tolerance: tolerance / 2, angularTolerance: 0.05 }); edges(m.vertices, m.triangles); }
  for (const mesh of meshes) edges(mesh.vertices, (mesh as { triangles?: ArrayLike<number> }).triangles ?? []);
  if (!samples.length) throw new Error("There is no body to spin.");
  let h0 = Infinity, h1 = -Infinity;
  for (const [h] of samples) { if (h < h0) h0 = h; if (h > h1) h1 = h; }
  if (h1 - h0 < 1e-9) throw new Error("The bodies have no length along that axis.");
  // The envelope: the largest radius per bin, ends at the extreme stations, gaps bridged.
  const bins = Math.min(512, Math.max(16, Math.ceil((h1 - h0) / tolerance))), width = (h1 - h0) / bins;
  const r = new Array<number>(bins + 1).fill(-1);
  for (const [h, rad] of samples) { const k = Math.round((h - h0) / width); r[k] = Math.max(r[k], rad); }
  for (let k = 0; k <= bins; k++) if (r[k] < 0) { let a = k - 1, b = k + 1; while (b <= bins && r[b] < 0) b++; r[k] = b > bins ? r[a] : a < 0 ? r[b] : r[a] + (r[b] - r[a]) * (k - a) / (b - a); }
  // Sketch-plane side of the axis: the in-plane perpendicular to it.
  const perp2: SketchPoint = (() => { const d: SketchPoint = [axis[1][0] - axis[0][0], axis[1][1] - axis[0][1]], l = Math.hypot(...d); return [-d[1] / l, d[0] / l]; })();
  const d2: SketchPoint = [(axis[1][0] - axis[0][0]) / Math.hypot(axis[1][0] - axis[0][0], axis[1][1] - axis[0][1]), (axis[1][1] - axis[0][1]) / Math.hypot(axis[1][0] - axis[0][0], axis[1][1] - axis[0][1])];
  const point = (h: number, rad: number): SketchPoint => [round(axis[0][0] + d2[0] * h + perp2[0] * rad), round(axis[0][1] + d2[1] * h + perp2[1] * rad)];
  const outline: SketchPoint[] = [point(h0, 0), ...r.map((rad, k) => point(h0 + k * width, rad)), point(h1, 0), point(h0, 0)];
  const dedup = outline.filter((p, i) => i === 0 || Math.hypot(p[0] - outline[i - 1][0], p[1] - outline[i - 1][1]) > 1e-9);
  return fitLinesAndArcs(dedup, tolerance);
}
