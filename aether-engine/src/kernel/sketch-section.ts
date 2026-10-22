import { cast, getOC, type AnyShape, type Edge, type Shape3D } from "replicad";
import type { PartDocument } from "../document/index";
import type { SketchContour, SketchFrame, SketchPoint } from "../sketch/drawing";
import { evaluatePartDocument } from "./part-evaluator";

export type SketchSectionKind = "section" | "edges";
type V3 = [number, number, number];
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** SolidCraft's Intersect and Include 3D Geometry: the curves where the sketch plane
 *  cuts the document's bodies (`section`), or the body edges lying in that plane
 *  (`edges`), as exact sketch contours in the frame's coordinates. Lines, circles and
 *  circular arcs stay exact; other curves are sampled into short lines. */
export function sketchSectionContours(document: PartDocument, frame: SketchFrame, kind: SketchSectionKind): SketchContour[] {
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
  evaluatePartDocument(document, { withBodies: (bodies) => {
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
