/** Curves taken from the model (SolidCraft's sketch.intersection_curve,
 *  sketch.isoparametric_curve, sketch.project_to_surface). Each returns world
 *  polylines the app turns into 3D sketch features. They are computed once,
 *  not linked: an edit upstream does not move them.
 *  - Intersection: the section of two bodies or faces (BRepAlgoAPI_Section).
 *  - Isoparametric: the u or v line of a face through a point.
 *  - Projection: the sketch curves swept along a direction into a ruled sheet,
 *    sectioned with the target face. */
import { cast, getOC, makeVertex, measureDistanceBetween, type AnyShape, type Face, type Shape3D } from "replicad";
import type { MeasureEntity } from "../contracts/index";
import { facesOf } from "./exact-topology";

type V3 = [number, number, number];
export interface DerivedCurveOptions {
  kind: "intersection_curve" | "isoparametric_curve" | "project_curve";
  entities?: MeasureEntity[];
  /** isoparametric: which parameter runs along the curve's direction (u: the curve follows u at fixed v). */
  uv?: "u" | "v";
  /** isoparametric: a point the curve passes through (default the face centre), mm. */
  point_mm?: V3;
  /** projection: world polylines of the sketch curves, mm, and the direction to project along. */
  polylines?: V3[][];
  direction?: V3;
}

/** The runs of a polyline that lie on a trimmed face. The parameter box of a face covers its
 *  holes and, for a planar face, the square around it; a point's distance to the face itself
 *  (which respects the trim) decides. */
export function clipToFace(face: Face, points: V3[], tolerance = 1e-5): V3[][] {
  const runs: V3[][] = [];
  let run: V3[] = [];
  for (const p of points) {
    const v = makeVertex(p);
    let on = false;
    try { on = measureDistanceBetween(face, v) <= tolerance; } finally { v.delete(); }
    if (on) run.push(p); else if (run.length) { if (run.length > 1) runs.push(run); run = []; }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/** One body or one face of a body, from a measure entity. */
function resolve(bodies: ReadonlyMap<string, Shape3D>, entity: MeasureEntity, own: (s: AnyShape) => void): AnyShape {
  const body = bodies.get(entity.body_id);
  if (!body) throw new Error("Pick faces or bodies of this part.");
  if (entity.face_id === undefined) return body;
  let face: Face | undefined;
  for (const item of facesOf(body)) { own(item.face); if (item.id === entity.face_id) face = item.face; }
  if (!face) throw new Error("A picked face is no longer on the part.");
  return face;
}

/** The edges of a shape sampled to world polylines, joined end to end where they meet. */
export function edgePolylines(shape: AnyShape): V3[][] {
  const oc = getOC();
  const pieces: V3[][] = [];
  const explorer = new oc.TopExp_Explorer_2(shape.wrapped, oc.TopAbs_ShapeEnum.TopAbs_EDGE as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never);
  while (explorer.More()) {
    const edge = oc.TopoDS.Edge_1(explorer.Current());
    const adaptor = new oc.BRepAdaptor_Curve_2(edge);
    const sampler = new oc.GCPnts_TangentialDeflection_2(adaptor as never, 0.1, 0.01, 2, 1e-9, 1e-7);
    const points: V3[] = [];
    for (let i = 1; i <= sampler.NbPoints(); i++) { const p = sampler.Value(i); points.push([p.X(), p.Y(), p.Z()]); p.delete(); }
    if (points.length > 1) pieces.push(points);
    sampler.delete(); adaptor.delete(); explorer.Next();
  }
  explorer.delete();
  // Join pieces whose ends meet (section edges come out unordered).
  const near = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-4;
  const chains: V3[][] = [];
  const left = [...pieces];
  while (left.length) {
    let chain = left.shift()!;
    for (let grown = true; grown; ) {
      grown = false;
      for (let i = 0; i < left.length; i++) {
        const p = left[i], head = chain[0], tail = chain[chain.length - 1];
        if (near(tail, p[0])) chain = [...chain, ...p.slice(1)];
        else if (near(tail, p[p.length - 1])) chain = [...chain, ...[...p].reverse().slice(1)];
        else if (near(head, p[p.length - 1])) chain = [...p, ...chain.slice(1)];
        else if (near(head, p[0])) chain = [...[...p].reverse(), ...chain.slice(1)];
        else continue;
        left.splice(i, 1); grown = true; break;
      }
    }
    chains.push(chain);
  }
  return chains;
}

function section(a: AnyShape, b: AnyShape): V3[][] {
  const oc = getOC();
  const algo = new oc.BRepAlgoAPI_Section_3(a.wrapped, b.wrapped, false);
  const progress = new oc.Message_ProgressRange_1();
  try {
    algo.Approximation(true);
    algo.Build(progress);
    if (!algo.IsDone()) throw new Error("The section could not be computed.");
    const result = cast(algo.Shape());
    try { return edgePolylines(result); } finally { result.delete(); }
  } finally { progress.delete(); algo.delete(); }
}

export function deriveCurves(bodies: ReadonlyMap<string, Shape3D>, options: DerivedCurveOptions): V3[][] {
  const owned: AnyShape[] = [];
  const own = (s: AnyShape) => { owned.push(s); };
  try {
    const entities = options.entities ?? [];
    if (options.kind === "intersection_curve") {
      if (entities.length !== 2) throw new Error("Pick two faces or bodies to intersect.");
      const curves = section(resolve(bodies, entities[0], own), resolve(bodies, entities[1], own));
      if (!curves.length) throw new Error("The two picks do not meet.");
      return curves;
    }
    if (options.kind === "isoparametric_curve") {
      const pick = entities.find((e) => e.face_id !== undefined && e.edge_index === undefined);
      if (!pick) throw new Error("Pick a face for the isoparametric curve.");
      const face = resolve(bodies, pick, own) as Face;
      const { uMin, uMax, vMin, vMax } = face.UVBounds;
      const at = options.point_mm ?? (() => { const c = face.center; const p: V3 = [c.x, c.y, c.z]; c.delete(); return p; })();
      // uvCoordinates answers in surface parameters; pointOnSurface takes 0..1 over the face's bounds.
      const [ua, va] = face.uvCoordinates(at);
      const u0 = (ua - uMin) / ((uMax - uMin) || 1), v0 = (va - vMin) / ((vMax - vMin) || 1);
      const points: V3[] = [];
      for (let i = 0; i <= 64; i++) {
        const t = i / 64;
        const p = options.uv === "v" ? face.pointOnSurface(u0, t) : face.pointOnSurface(t, v0);
        points.push([p.x, p.y, p.z]); p.delete();
      }
      const runs = clipToFace(face, points);
      if (!runs.length) throw new Error("That line misses the face. Pick a point on it.");
      return runs;
    }
    if (options.kind === "project_curve") {
      const pick = entities.find((e) => e.face_id !== undefined && e.edge_index === undefined);
      if (!pick) throw new Error("Pick the face to project onto.");
      const d = options.direction;
      if (!d || Math.hypot(...d) < 1e-9) throw new Error("Projection needs a direction.");
      if (!options.polylines?.length) throw new Error("Choose a sketch with curves to project.");
      const face = resolve(bodies, pick, own);
      const oc = getOC();
      const n = Math.hypot(...d), dir: V3 = [d[0] / n, d[1] / n, d[2] / n];
      const bb = face.boundingBox; const span = Math.hypot(...bb.bounds[1].map((v, i) => v - bb.bounds[0][i])) || 1; bb.delete();
      const reach = span * 4 + 1000;
      const curves: V3[][] = [];
      for (const polyline of options.polylines) {
        if (polyline.length < 2) continue;
        // A ruled sheet: each segment, pulled back by `reach`, swept 2·reach along the direction.
        const builder = new oc.TopoDS_Builder(), compound = new oc.TopoDS_Compound();
        builder.MakeCompound(compound);
        for (let i = 1; i < polyline.length; i++) {
          const a = polyline[i - 1], b = polyline[i];
          if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-9) continue;
          const p1 = new oc.gp_Pnt_3(a[0] - dir[0] * reach, a[1] - dir[1] * reach, a[2] - dir[2] * reach), p2 = new oc.gp_Pnt_3(b[0] - dir[0] * reach, b[1] - dir[1] * reach, b[2] - dir[2] * reach);
          const edge = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2), vec = new oc.gp_Vec_4(dir[0] * 2 * reach, dir[1] * 2 * reach, dir[2] * 2 * reach);
          const prism = new oc.BRepPrimAPI_MakePrism_1(edge.Edge(), vec, false, true);
          builder.Add(compound, prism.Shape());
          prism.delete(); vec.delete(); edge.delete(); p1.delete(); p2.delete();
        }
        builder.delete();
        const sheet = cast(compound);
        try { curves.push(...section(sheet, face)); } finally { sheet.delete(); }
      }
      if (!curves.length) throw new Error("The sketch does not project onto that face along its normal.");
      return curves;
    }
    throw new Error("Choose intersection, isoparametric or projection.");
  } finally { owned.forEach((s) => { try { s.delete(); } catch { /* gone */ } }); }
}
