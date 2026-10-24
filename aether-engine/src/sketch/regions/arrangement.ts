/** The planar arrangement of a sketch: every non-construction curve split where it
 *  meets another, joined into a graph, and the graph's faces traced. Each bounded
 *  face is a region a feature can be built on — two overlapping shapes give three
 *  regions, a line across a rectangle gives two, a circle inside a rectangle gives a
 *  ring and a disk — as Onshape and SolidCraft find a sketch's regions.
 *
 *  Boundaries are exact: pieces are the authored curves subdivided at their
 *  intersections (degree preserving), never polygons. Polylines are used only to
 *  classify (areas, containment), never saved or built. */
import type { SketchContour, SketchDrawing, SketchPoint, SketchSegment } from "../drawing";
import { curveIntersections, type Curve } from "../curves/pairs";
import { circleSegments } from "../curves/picking";
import { subdivideSegment } from "../curves/subdivide";
import { closestSegmentParameter, segmentPoint } from "../curves/parameterization";

type Path = Extract<SketchContour, { type: "path" }>;

export interface ArrangementFace {
  /** The face's outer boundary, counter-clockwise. */
  boundary: Path;
  /** Islands inside it (each another part of the sketch's outer boundary). */
  holes: Path[];
  /** Authored contours whose curves bound the face (outer boundary and holes), sorted. */
  sourceContourIndices: number[];
  /** Closed authored contours whose interior holds the face, sorted. */
  insideContourIndices: number[];
  /** A point inside the face (not in a hole). */
  sample: SketchPoint;
  /** Area, mm² (holes taken out). */
  area: number;
}

interface Piece { contour: number; curve: Curve; from: number; to: number }

const dist = (a: SketchPoint, b: SketchPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** A piece run backwards, exactly (arc middle kept, Bézier controls swapped, ellipse sweep flipped). */
function reversed(curve: Curve): Curve {
  const s = curve.segment;
  const { id: _id, endVertexId: _v, ...rest } = structuredClone(s) as SketchSegment;
  const end: SketchPoint = [...curve.start];
  const segment = {
    ...rest, end,
    ...(rest.type === "bezier" ? { controls: [rest.controls[1], rest.controls[0]] } : {}),
    ...(rest.type === "ellipse" ? { sweep: !rest.sweep } : {}),
  } as SketchSegment;
  if (rest.type === "conic") return conicReversed(curve);
  return { start: [...s.end], segment };
}
/** Conics are split and sampled through their own geometry; reversing goes through
 *  subdivision-free resampling of the same carrier: refuse rather than guess. */
function conicReversed(_curve: Curve): Curve { throw new Error("conic boundaries are not arranged"); }

function samples(curve: Curve, n = 24): SketchPoint[] {
  return Array.from({ length: n + 1 }, (_, i) => segmentPoint(curve.start, curve.segment, i / n));
}
const signedArea = (poly: SketchPoint[]) => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
};
function contains(poly: SketchPoint[], p: SketchPoint): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const polyline = (curves: Curve[]) => curves.flatMap((c) => samples(c, c.segment.type === "line" ? 1 : 96).slice(0, -1));
const toPath = (curves: Curve[]): Path => ({ type: "path", start: [...curves[0].start], segments: curves.map((c) => c.segment) });

/** The sketch's arrangement, or undefined when it cannot be built exactly (overlapping
 *  collinear curves, conics, numerically ambiguous crossings) — the caller then keeps
 *  one region per closed contour. */
export function sketchArrangement(drawing: SketchDrawing): ArrangementFace[] | undefined {
  const source: { contour: number; curve: Curve }[] = [];
  drawing.contours.forEach((c, contour) => {
    if (c.construction || (c.type === "path" && c.infinite)) return;
    if (c.type === "circle") { if (c.radius > 0) for (const curve of circleSegments(c.center, c.radius)) source.push({ contour, curve }); return; }
    let start = c.start;
    for (const segment of c.segments) { source.push({ contour, curve: { start, segment } }); start = segment.end; }
  });
  if (!source.length || source.some((s) => s.curve.segment.type === "conic")) return undefined;
  const all = source.flatMap((s) => samples(s.curve, 8));
  const scale = Math.max(1, ...all.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1]))));
  const tol = 1e-7 * scale;
  // Bounding boxes, grown for an arc's bulge between samples.
  const boxes = source.map((s) => {
    const pts = samples(s.curve, 16);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const pad = 0.05 * Math.hypot(x1 - x0, y1 - y0) + tol;
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  });
  const cuts: number[][] = source.map(() => []);
  try {
    for (let i = 0; i < source.length; i++) for (let j = i + 1; j < source.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a[0] > b[2] || b[0] > a[2] || a[1] > b[3] || b[1] > a[3]) continue;
      for (const hit of curveIntersections(source[i].curve, source[j].curve)) { cuts[i].push(hit.first); cuts[j].push(hit.second); }
    }
  } catch { return undefined; }
  // Split each curve at its interior cuts, exactly.
  const pieces: Piece[] = [];
  source.forEach((s, k) => {
    const ts = [...new Set(cuts[k].filter((t) => t > 1e-9 && t < 1 - 1e-9))].sort((a, b) => a - b);
    const points = ts.map((t) => segmentPoint(s.curve.start, s.curve.segment, t));
    let rest: Curve = s.curve;
    for (const p of points) {
      if (dist(p, rest.start) <= tol || dist(p, rest.segment.end) <= tol) continue;
      const t = closestSegmentParameter(rest.start, rest.segment, p).parameter;
      if (t <= 1e-9 || t >= 1 - 1e-9) continue;
      const [a, b] = subdivideSegment(rest.start, rest.segment, t);
      pieces.push({ contour: s.contour, curve: { start: rest.start, segment: a }, from: -1, to: -1 });
      rest = { start: a.end, segment: b };
    }
    pieces.push({ contour: s.contour, curve: rest, from: -1, to: -1 });
  });
  // Nodes: piece ends within the tolerance are one node.
  const nodes: SketchPoint[] = [];
  const node = (p: SketchPoint) => { const k = nodes.findIndex((n) => dist(n, p) <= 1e3 * tol); if (k >= 0) return k; nodes.push(p); return nodes.length - 1; };
  for (const piece of pieces) { piece.from = node(piece.curve.start); piece.to = node(piece.curve.segment.end); }
  let live = pieces.filter((p) => p.from !== p.to || samples(p.curve, 4).some((q) => dist(q, p.curve.start) > 1e3 * tol));
  // Dangling curves bound nothing: peel them off.
  for (let changed = true; changed;) {
    changed = false;
    const degree = new Map<number, number>();
    for (const p of live) { degree.set(p.from, (degree.get(p.from) ?? 0) + 1); degree.set(p.to, (degree.get(p.to) ?? 0) + 1); }
    const kept = live.filter((p) => degree.get(p.from)! > 1 && degree.get(p.to)! > 1);
    if (kept.length !== live.length) { live = kept; changed = true; }
  }
  if (!live.length) return [];
  // Half-edges: 2k runs piece k forward, 2k+1 backwards. Each leaves its node at an angle
  // read a little way along it (so tangent curves still order by their bend).
  const half = live.flatMap((p) => [
    { piece: p, curve: p.curve, from: p.from, to: p.to },
    { piece: p, curve: reversed(p.curve), from: p.to, to: p.from },
  ]);
  const angle = (h: (typeof half)[number]) => {
    const o = h.curve.start, q = segmentPoint(h.curve.start, h.curve.segment, 1e-3);
    return Math.atan2(q[1] - o[1], q[0] - o[0]);
  };
  const out = new Map<number, number[]>();
  half.forEach((h, i) => out.set(h.from, [...(out.get(h.from) ?? []), i]));
  for (const list of out.values()) list.sort((a, b) => angle(half[a]) - angle(half[b]));
  // Next around a face (on its left): at the end node, the outgoing half-edge just
  // clockwise of the way back.
  const next = (i: number) => {
    const list = out.get(half[i].to)!, back = i ^ 1, k = list.indexOf(back);
    return list[(k - 1 + list.length) % list.length];
  };
  const used = new Set<number>(), loops: { curves: Curve[]; pieces: Piece[]; area: number; poly: SketchPoint[] }[] = [];
  for (let i = 0; i < half.length; i++) {
    if (used.has(i)) continue;
    const curves: Curve[] = [], ps: Piece[] = [];
    let h = i;
    for (let guard = 0; !used.has(h) && guard <= half.length; guard++) { used.add(h); curves.push(half[h].curve); ps.push(half[h].piece); h = next(h); }
    if (h !== i) return undefined;
    const poly = polyline(curves);
    loops.push({ curves, pieces: ps, area: signedArea(poly), poly });
  }
  const faces = loops.filter((l) => l.area > tol * tol);
  const outers = loops.filter((l) => l.area < -tol * tol);
  // Each component's outer boundary (a clockwise loop) is a hole of the smallest face of
  // another component around it.
  const holesOf = new Map<(typeof faces)[number], (typeof outers)[number][]>();
  for (const outer of outers) {
    const at = outer.poly[0];
    const around = faces.filter((f) => !f.pieces.some((p) => outer.pieces.includes(p)) && contains(f.poly, at)).sort((a, b) => a.area - b.area)[0];
    if (around) holesOf.set(around, [...(holesOf.get(around) ?? []), outer]);
  }
  // Closed authored contours, as polylines, for the inside test.
  const closed = drawing.contours.flatMap((c, index) => {
    if (c.construction) return [];
    if (c.type === "circle") return [{ index, poly: polyline(circleSegments(c.center, c.radius)) }];
    if (!c.segments.length || dist(c.start, c.segments.at(-1)!.end) > 1e-6) return [];
    let start = c.start;
    return [{ index, poly: polyline(c.segments.map((segment) => { const curve = { start, segment }; start = segment.end; return curve; })) }];
  });
  return faces.map((face) => {
    const holes = holesOf.get(face) ?? [];
    const sample = interiorPoint(face.poly, holes.map((h) => h.poly));
    const sources = new Set([...face.pieces, ...holes.flatMap((h) => h.pieces)].map((p) => p.contour));
    return {
      boundary: toPath(face.curves),
      holes: holes.map((h) => toPath(h.curves)),
      sourceContourIndices: [...sources].sort((a, b) => a - b),
      insideContourIndices: closed.filter((c) => contains(c.poly, sample)).map((c) => c.index),
      sample,
      area: face.area + holes.reduce((sum, h) => sum + h.area, 0),
    };
  });
}

/** A point well inside a polygon and outside its holes: the middle of the widest
 *  inside run of a few horizontal scanlines. */
function interiorPoint(poly: SketchPoint[], holes: SketchPoint[][]): SketchPoint {
  let y0 = Infinity, y1 = -Infinity;
  for (const p of poly) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  let best: SketchPoint = poly[0], width = -1;
  for (let k = 1; k < 16; k++) {
    const y = y0 + ((y1 - y0) * k) / 16, xs: number[] = [];
    for (const ring of [poly, ...holes]) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > width) { width = xs[i + 1] - xs[i]; best = [(xs[i] + xs[i + 1]) / 2, y]; }
  }
  return best;
}
