/** Curve and surface quality (SolidCraft's inspect.continuity, curvature_comb,
 *  isocurve and minimum_radius): exact derivatives from OCCT's adaptors, the
 *  arithmetic in TypeScript because the wasm build carries no LProp classes.
 *  Results are measurements plus world polylines for the viewport to draw. */
import { getOC, type AnyShape, type Edge, type Face, type Shape3D } from "replicad";
import type { MeasureEntity } from "../contracts/index";
import { facesOf } from "./exact-topology";
import { clipToFace } from "./derived-curves";

type V3 = [number, number, number];
export interface CurveOverlay { label: string; color: string; polylines: V3[][] }
export interface CurveAnalysisOptions {
  kind: "continuity" | "curvature_comb" | "isocurve" | "minimum_radius";
  /** Faces (face_id) or edges (face_id + edge_index) to analyse; none: every one of every body. */
  entities?: MeasureEntity[];
  /** isocurve: curves each way (default 8); curvature_comb: samples per edge (default 48). */
  count?: number;
  /** curvature_comb: tooth length in mm per unit curvature (1/mm); default fits the longest tooth to a tenth of the model. */
  scale?: number;
  /** minimum_radius: radii below this (mm) are flagged. */
  radius_mm?: number;
}
export interface CurveAnalysisResult { measurements: Record<string, unknown>[]; curves: CurveOverlay[] }

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const n = norm(a); return n > 1e-12 ? mul(a, 1 / n) : [0, 0, 0]; };

interface PickedFace { bodyId: string; faceId: number; face: Face }
interface PickedEdge { bodyId: string; faceId: number; edgeIndex: number; edge: Edge }

/** Every face of the chosen bodies, or the ones the entities name. Wrappers are owned by `own`. */
function pickFaces(bodies: ReadonlyMap<string, Shape3D>, entities: MeasureEntity[] | undefined, own: (s: AnyShape) => void): PickedFace[] {
  const wanted = entities?.filter((e) => e.face_id !== undefined && e.edge_index === undefined) ?? [];
  const bodyIds = new Set((entities ?? []).map((e) => e.body_id));
  const out: PickedFace[] = [];
  for (const [bodyId, body] of bodies) {
    if (bodyIds.size && !bodyIds.has(bodyId)) continue;
    for (const item of facesOf(body)) {
      own(item.face);
      if (!wanted.length || wanted.some((e) => e.body_id === bodyId && e.face_id === item.id)) out.push({ bodyId, faceId: item.id, face: item.face });
    }
  }
  return out;
}
/** Every distinct edge of the chosen bodies (an edge is seen from two faces; it counts once), or the named edges. */
function pickEdges(bodies: ReadonlyMap<string, Shape3D>, entities: MeasureEntity[] | undefined, own: (s: AnyShape) => void): PickedEdge[] {
  const wanted = entities?.filter((e) => e.edge_index !== undefined) ?? [];
  const bodyIds = new Set((entities ?? []).map((e) => e.body_id));
  const out: PickedEdge[] = [];
  for (const [bodyId, body] of bodies) {
    if (bodyIds.size && !bodyIds.has(bodyId)) continue;
    const seen: Edge[] = [];
    for (const item of facesOf(body)) {
      own(item.face);
      item.face.edges.forEach((edge, edgeIndex) => {
        own(edge);
        if (wanted.length ? !wanted.some((e) => e.body_id === bodyId && e.face_id === item.id && e.edge_index === edgeIndex) : seen.some((s) => s.isSame(edge))) return;
        seen.push(edge);
        out.push({ bodyId, faceId: item.id, edgeIndex, edge });
      });
    }
  }
  return out;
}

interface CurveSample { point: V3; tangent: V3; curvature: number; direction: V3 }
/** Position, unit tangent, curvature and the unit vector toward the centre of curvature, at even parameter steps. */
function sampleEdge(edge: Edge, count: number): CurveSample[] {
  const oc = getOC();
  const adaptor = new oc.BRepAdaptor_Curve_2(edge.wrapped);
  const p = new oc.gp_Pnt_1(), d1 = new oc.gp_Vec_1(), d2 = new oc.gp_Vec_1();
  try {
    const u0 = adaptor.FirstParameter(), u1 = adaptor.LastParameter();
    const out: CurveSample[] = [];
    for (let i = 0; i <= count; i++) {
      adaptor.D2(u0 + (u1 - u0) * (i / count), p, d1, d2);
      const t: V3 = [d1.X(), d1.Y(), d1.Z()], s: V3 = [d2.X(), d2.Y(), d2.Z()];
      const speed = norm(t);
      const curvature = speed > 1e-12 ? norm(cross(t, s)) / speed ** 3 : 0;
      const normalPart = sub(s, mul(t, dot(t, s) / Math.max(speed * speed, 1e-18)));
      out.push({ point: [p.X(), p.Y(), p.Z()], tangent: unit(t), curvature, direction: curvature > 1e-9 ? unit(normalPart) : [0, 0, 0] });
    }
    return out;
  } finally { p.delete(); d1.delete(); d2.delete(); adaptor.delete(); }
}

interface SurfaceSample { point: V3; normal: V3; E: number; F: number; G: number; L: number; M: number; N: number; du: V3; dv: V3 }
/** First and second fundamental forms at (u, v). */
function sampleSurface(adaptor: InstanceType<ReturnType<typeof getOC>["BRepAdaptor_Surface_2"]>, u: number, v: number, scratch: { p: any; d1u: any; d1v: any; d2u: any; d2v: any; d2uv: any }): SurfaceSample {
  adaptor.D2(u, v, scratch.p, scratch.d1u, scratch.d1v, scratch.d2u, scratch.d2v, scratch.d2uv);
  const du: V3 = [scratch.d1u.X(), scratch.d1u.Y(), scratch.d1u.Z()], dv: V3 = [scratch.d1v.X(), scratch.d1v.Y(), scratch.d1v.Z()];
  const duu: V3 = [scratch.d2u.X(), scratch.d2u.Y(), scratch.d2u.Z()], dvv: V3 = [scratch.d2v.X(), scratch.d2v.Y(), scratch.d2v.Z()], duv: V3 = [scratch.d2uv.X(), scratch.d2uv.Y(), scratch.d2uv.Z()];
  const normal = unit(cross(du, dv));
  return { point: [scratch.p.X(), scratch.p.Y(), scratch.p.Z()], normal, E: dot(du, du), F: dot(du, dv), G: dot(dv, dv), L: dot(duu, normal), M: dot(duv, normal), N: dot(dvv, normal), du, dv };
}
/** Principal curvatures from the fundamental forms. */
function principalCurvatures(s: SurfaceSample): [number, number] {
  const det = s.E * s.G - s.F * s.F;
  if (det < 1e-18) return [0, 0];
  const K = (s.L * s.N - s.M * s.M) / det, H = (s.E * s.N - 2 * s.F * s.M + s.G * s.L) / (2 * det);
  const root = Math.sqrt(Math.max(H * H - K, 0));
  return [H + root, H - root];
}
/** Normal curvature of the surface in world direction w (in the tangent plane). */
function normalCurvature(s: SurfaceSample, w: V3): number {
  // Solve [E F; F G]·(du, dv) = (du·w, dv·w) for the parameter direction of w.
  const det = s.E * s.G - s.F * s.F;
  if (det < 1e-18) return 0;
  const a = dot(s.du, w), b = dot(s.dv, w);
  const du = (s.G * a - s.F * b) / det, dv = (s.E * b - s.F * a) / det;
  const I = s.E * du * du + 2 * s.F * du * dv + s.G * dv * dv;
  return I > 1e-18 ? (s.L * du * du + 2 * s.M * du * dv + s.N * dv * dv) / I : 0;
}
function withSurface<T>(face: Face, run: (adaptor: any, scratch: { p: any; d1u: any; d1v: any; d2u: any; d2v: any; d2uv: any }) => T): T {
  const oc = getOC();
  const adaptor = new oc.BRepAdaptor_Surface_2(face.wrapped, true);
  const scratch = { p: new oc.gp_Pnt_1(), d1u: new oc.gp_Vec_1(), d1v: new oc.gp_Vec_1(), d2u: new oc.gp_Vec_1(), d2v: new oc.gp_Vec_1(), d2uv: new oc.gp_Vec_1() };
  try { return run(adaptor, scratch); }
  finally { Object.values(scratch).forEach((o) => o.delete()); adaptor.delete(); }
}
const bounds = (bodies: ReadonlyMap<string, Shape3D>) => {
  let lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const body of bodies.values()) { const b = body.boundingBox; lo = [Math.min(lo[0], b.bounds[0][0]), Math.min(lo[1], b.bounds[0][1]), Math.min(lo[2], b.bounds[0][2])]; hi = [Math.max(hi[0], b.bounds[1][0]), Math.max(hi[1], b.bounds[1][1]), Math.max(hi[2], b.bounds[1][2])]; b.delete(); }
  return norm(sub(hi, lo)) || 1;
};

export function analyzeCurves(bodies: ReadonlyMap<string, Shape3D>, options: CurveAnalysisOptions): CurveAnalysisResult {
  const owned: AnyShape[] = [];
  const own = (s: AnyShape) => { owned.push(s); };
  const measurements: Record<string, unknown>[] = [], curves: CurveOverlay[] = [];
  try {
    if (options.kind === "curvature_comb") {
      const edges = pickEdges(bodies, options.entities, own);
      if (!edges.length) throw new Error("Curvature comb needs an edge.");
      const samples = edges.map((e) => ({ ...e, samples: sampleEdge(e.edge, Math.max(8, Math.min(400, Math.round(options.count ?? 48)))) }));
      const maxCurvature = Math.max(1e-9, ...samples.flatMap((e) => e.samples.map((s) => s.curvature)));
      const scale = options.scale ?? (bounds(bodies) * 0.1) / maxCurvature;
      for (const e of samples) {
        const teeth: V3[][] = [], tips: V3[] = [];
        for (const s of e.samples) { const tip = add(s.point, mul(s.direction, -s.curvature * scale)); teeth.push([s.point, tip]); tips.push(tip); }
        curves.push({ label: `comb ${e.bodyId} face ${e.faceId} edge ${e.edgeIndex}`, color: "#f2b134", polylines: [...teeth, tips] });
        const peak = Math.max(...e.samples.map((s) => s.curvature));
        measurements.push({ body_id: e.bodyId, face_id: e.faceId, edge_index: e.edgeIndex, max_curvature_per_mm: peak, min_radius_mm: peak > 1e-9 ? 1 / peak : null, scale_mm: scale });
      }
    } else if (options.kind === "minimum_radius") {
      const faces = pickFaces(bodies, options.entities, own);
      const edges = options.entities?.some((e) => e.edge_index !== undefined) ? pickEdges(bodies, options.entities, own) : [];
      if (!faces.length && !edges.length) throw new Error("Minimum radius needs a face or an edge.");
      const threshold = options.radius_mm;
      let overall: { radius: number; at: V3 } | null = null;
      const note = (radius: number, at: V3) => { if (!overall || radius < overall.radius) overall = { radius, at }; };
      for (const f of faces) {
        const { uMin, uMax, vMin, vMax } = f.face.UVBounds;
        const best = withSurface(f.face, (adaptor, scratch) => {
          let found: { radius: number; at: V3 } | null = null;
          const n = 16;
          for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
            const s = sampleSurface(adaptor, uMin + (uMax - uMin) * (i / n), vMin + (vMax - vMin) * (j / n), scratch);
            const k = Math.max(...principalCurvatures(s).map(Math.abs));
            if (k > 1e-9 && (!found || 1 / k < found.radius)) found = { radius: 1 / k, at: s.point };
          }
          return found;
        });
        measurements.push({ body_id: f.bodyId, face_id: f.faceId, min_radius_mm: best?.radius ?? null, at_mm: best?.at ?? null, flagged: best !== null && threshold !== undefined && best.radius < threshold });
        if (best) note(best.radius, best.at);
      }
      for (const e of edges) {
        const samples = sampleEdge(e.edge, 64);
        const peak = samples.reduce((a, s) => (s.curvature > a.curvature ? s : a), samples[0]);
        const radius = peak.curvature > 1e-9 ? 1 / peak.curvature : null;
        measurements.push({ body_id: e.bodyId, face_id: e.faceId, edge_index: e.edgeIndex, min_radius_mm: radius, at_mm: radius === null ? null : peak.point, flagged: radius !== null && threshold !== undefined && radius < threshold });
        if (radius !== null) note(radius, peak.point);
      }
      const o = overall as { radius: number; at: V3 } | null;
      if (o) {
        const r = Math.max(bounds(bodies) * 0.01, 0.5), [x, y, z] = o.at;
        curves.push({ label: `minimum radius ${o.radius.toFixed(3)} mm`, color: threshold !== undefined && o.radius < threshold ? "#e5484d" : "#30a46c", polylines: [[[x - r, y, z], [x + r, y, z]], [[x, y - r, z], [x, y + r, z]], [[x, y, z - r], [x, y, z + r]]] });
        measurements.push({ overall_min_radius_mm: o.radius, at_mm: o.at });
      }
    } else if (options.kind === "isocurve") {
      const faces = pickFaces(bodies, options.entities, own);
      if (!faces.length) throw new Error("Isocurves need a face.");
      const count = Math.max(1, Math.min(64, Math.round(options.count ?? 8)));
      for (const f of faces) {
        // replicad's pointOnSurface takes 0..1 over the face's parameter bounds.
        const line = (fixedU: boolean, k: number): V3[] => {
          const t = (k + 0.5) / count, pts: V3[] = [];
          for (let i = 0; i <= 32; i++) {
            const a = i / 32;
            const p = fixedU ? f.face.pointOnSurface(t, a) : f.face.pointOnSurface(a, t);
            pts.push([p.x, p.y, p.z]); p.delete();
          }
          return pts;
        };
        // Clipped to the trimmed face: holes and the corners of a planar face's parameter box drop out.
        curves.push({ label: `u ${f.bodyId} face ${f.faceId}`, color: "#3e8ef7", polylines: Array.from({ length: count }, (_, k) => clipToFace(f.face, line(true, k))).flat() });
        curves.push({ label: `v ${f.bodyId} face ${f.faceId}`, color: "#e879f9", polylines: Array.from({ length: count }, (_, k) => clipToFace(f.face, line(false, k))).flat() });
        measurements.push({ body_id: f.bodyId, face_id: f.faceId, count, surface: f.face.geomType });
      }
    } else if (options.kind === "continuity") {
      const edges = pickEdges(bodies, options.entities, own);
      if (!edges.length) throw new Error("Continuity needs an edge between two faces.");
      // Both faces along each edge, found by identity among the body's faces.
      const facesByBody = new Map<string, { id: number; face: Face }[]>();
      for (const [bodyId, body] of bodies) { const list = facesOf(body).map((i) => ({ id: i.id, face: i.face })); list.forEach((i) => own(i.face)); facesByBody.set(bodyId, list); }
      for (const e of edges) {
        const adjacent = (facesByBody.get(e.bodyId) ?? []).filter((f) => { const edges = f.face.edges; const hit = edges.some((x) => x.isSame(e.edge)); edges.forEach((x) => x.delete()); return hit; });
        if (adjacent.length !== 2) { measurements.push({ body_id: e.bodyId, face_id: e.faceId, edge_index: e.edgeIndex, continuity: "open", faces: adjacent.map((f) => f.id) }); continue; }
        const samples = sampleEdge(e.edge, 8).slice(1, -1);
        let maxAngle = 0, maxCurvatureGap = 0;
        for (const s of samples) {
          const normals = adjacent.map((f) => { const n = f.face.normalAt([s.point[0], s.point[1], s.point[2]]); const v: V3 = [n.x, n.y, n.z]; n.delete(); return unit(v); });
          const angle = Math.acos(Math.max(-1, Math.min(1, dot(normals[0], normals[1])))) * 180 / Math.PI;
          maxAngle = Math.max(maxAngle, angle);
          if (angle < 0.5) {
            // Across the edge, inside the shared tangent plane: compare normal curvatures.
            const across = unit(cross(normals[0], s.tangent));
            const kappas = adjacent.map((f) => withSurface(f.face, (adaptor, scratch) => { const [u, v] = f.face.uvCoordinates([s.point[0], s.point[1], s.point[2]]); return normalCurvature(sampleSurface(adaptor, u, v, scratch), across); }));
            maxCurvatureGap = Math.max(maxCurvatureGap, Math.abs(Math.abs(kappas[0]) - Math.abs(kappas[1])));
          }
        }
        const continuity = maxAngle >= 0.5 ? "G0" : maxCurvatureGap > 1e-3 ? "G1" : "G2";
        measurements.push({ body_id: e.bodyId, face_id: e.faceId, edge_index: e.edgeIndex, continuity, max_normal_angle_deg: maxAngle, max_curvature_gap_per_mm: maxCurvatureGap, faces: adjacent.map((f) => f.id) });
        curves.push({ label: `${continuity} ${e.bodyId} face ${e.faceId} edge ${e.edgeIndex}`, color: continuity === "G0" ? "#e5484d" : continuity === "G1" ? "#f2b134" : "#30a46c", polylines: [sampleEdge(e.edge, 24).map((s) => s.point)] });
      }
    } else throw new Error("Choose continuity, curvature comb, isocurve or minimum radius.");
    return { measurements, curves };
  } finally { owned.forEach((s) => { try { s.delete(); } catch { /* already gone */ } }); }
}
