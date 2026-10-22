import type { AxisReference, PlaneReference, PointReference, ConstructionPlaneFeature } from "./construction-planes";
import { resolvePlaneFrame } from "./construction-planes";

/** Construction-point semantics (SolidCraft's construct.point.*): at a picked
 *  vertex, where two edges meet (or come closest), where three planes meet, at
 *  the centre of a circular edge, where an edge meets a plane, or a fraction along
 *  a straight edge. Picked geometry is captured at pick time. */
export type PointDefinition =
  | { method: "vertex"; point: PointReference }
  | { method: "two-edges"; axes: [AxisReference, AxisReference] }
  | { method: "three-planes"; references: [PlaneReference, PlaneReference, PlaneReference] }
  | { method: "center"; axis: AxisReference }
  | { method: "edge-plane"; axis: AxisReference; reference: PlaneReference }
  | { method: "along-path"; axis: AxisReference; t: number };

export interface ConstructionPointFeature {
  id: string;
  name: string;
  type: "point";
  suppressed: boolean;
  definition: PointDefinition;
}

type V3 = [number, number, number];
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: readonly number[], b: readonly number[], s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: readonly number[], what: string): V3 => { const l = Math.hypot(v[0], v[1], v[2]); if (!(l > 1e-9)) throw new Error(`${what} has no direction.`); return [v[0] / l, v[1] / l, v[2] / l]; };

export function resolvePointPosition(feature: ConstructionPointFeature, earlier: readonly { id: string; type: string }[] = []): V3 {
  const d = feature.definition;
  const frameOf = (reference: PlaneReference) => {
    if (reference.kind === "principal") return resolvePlaneFrame({ id: "", name: "", type: "plane", plane: reference.plane, offsetMillimeters: 0, suppressed: false }, []);
    if (reference.kind === "face") return reference.frame;
    const index = earlier.findIndex((f) => f.id === reference.featureId), target = index >= 0 ? earlier[index] : undefined;
    if (!target || target.type !== "plane") throw new Error(`${feature.name}: plane references must be earlier construction planes.`);
    return resolvePlaneFrame(target as ConstructionPlaneFeature, earlier.slice(0, index));
  };
  if (d.method === "vertex") return [...d.point.positionMillimeters];
  if (d.method === "center") return [...d.axis.originMillimeters];
  if (d.method === "two-edges") {
    // The closest points of two lines; their midpoint when the lines miss each other.
    const [a, b] = d.axes, u = unit(a.directionMillimeters, `${feature.name}: the first edge`), v = unit(b.directionMillimeters, `${feature.name}: the second edge`);
    const w = sub(a.originMillimeters, b.originMillimeters), uv = dot(u, v), den = 1 - uv * uv;
    if (Math.abs(den) < 1e-12) throw new Error(`${feature.name}: the two edges are parallel and do not meet.`);
    const s = (uv * dot(v, w) - dot(u, w)) / den, t = (dot(v, w) - uv * dot(u, w)) / den;
    const p = add(a.originMillimeters, u, s), q = add(b.originMillimeters, v, t);
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
  }
  if (d.method === "three-planes") {
    const [a, b, c] = d.references.map(frameOf), n1 = a.normal, n2 = b.normal, n3 = c.normal;
    const det = dot(n1, cross(n2, n3));
    if (Math.abs(det) < 1e-9) throw new Error(`${feature.name}: the three planes do not meet at one point.`);
    const d1 = dot(n1, a.originMillimeters), d2 = dot(n2, b.originMillimeters), d3 = dot(n3, c.originMillimeters);
    const term = (n: V3, k: number) => n.map((v) => v * k) as V3;
    const sum = [term(cross(n2, n3), d1), term(cross(n3, n1), d2), term(cross(n1, n2), d3)];
    return [(sum[0][0] + sum[1][0] + sum[2][0]) / det, (sum[0][1] + sum[1][1] + sum[2][1]) / det, (sum[0][2] + sum[1][2] + sum[2][2]) / det];
  }
  if (d.method === "edge-plane") {
    const u = unit(d.axis.directionMillimeters, `${feature.name}: the edge`), frame = frameOf(d.reference);
    const den = dot(u, frame.normal);
    if (Math.abs(den) < 1e-9) throw new Error(`${feature.name}: the edge is parallel to the plane.`);
    const t = dot(sub(frame.originMillimeters, d.axis.originMillimeters), frame.normal) / den;
    return add(d.axis.originMillimeters, u, t);
  }
  const u = unit(d.axis.directionMillimeters, `${feature.name}: the path`);
  if (!Number.isFinite(d.t) || d.t < 0 || d.t > 1) throw new Error(`${feature.name}: the path fraction must be between 0 and 1.`);
  return add(d.axis.originMillimeters, u, (d.t - 0.5) * (d.axis.lengthMillimeters ?? 0));
}

export function validatePointDefinition(feature: ConstructionPointFeature, earlierPlanes: ReadonlySet<string>, missing: (id: unknown) => boolean = () => false): void {
  const d = feature.definition;
  const v3 = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  const axis = (a: unknown, what: string) => { const x = a as AxisReference; if (!x || x.kind !== "axis" || typeof x.partId !== "string" || typeof x.candidateId !== "string" || !v3(x.originMillimeters) || !v3(x.directionMillimeters)) throw new Error(`${what} needs a picked edge.`); };
  const plane = (r: unknown) => {
    const p = r as PlaneReference;
    if (!p || typeof p !== "object") throw new Error("Point needs a plane reference.");
    if (p.kind === "principal") { if (!["XY", "XZ", "YZ"].includes(p.plane)) throw new Error("Invalid principal plane."); return; }
    if (p.kind === "feature") { if (typeof p.featureId !== "string" || (!earlierPlanes.has(p.featureId) && !missing(p.featureId))) throw new Error("Point plane references must be earlier construction planes."); return; }
    if (p.kind === "face") { if (typeof p.partId !== "string" || !Number.isInteger(p.faceId) || !p.frame || !v3(p.frame.normal) || !v3(p.frame.originMillimeters)) throw new Error("Invalid face reference."); return; }
    throw new Error("Invalid plane reference.");
  };
  if (!d || typeof d !== "object") throw new Error("Point needs a definition.");
  if (d.method === "vertex") { const q = d.point; if (!q || q.kind !== "point" || typeof q.partId !== "string" || typeof q.candidateId !== "string" || !v3(q.positionMillimeters)) throw new Error("Point at vertex needs a picked vertex."); return; }
  if (d.method === "two-edges") { if (!Array.isArray(d.axes) || d.axes.length !== 2) throw new Error("Point through two edges needs exactly two edges."); d.axes.forEach((a) => axis(a, "Point through two edges")); return; }
  if (d.method === "three-planes") { if (!Array.isArray(d.references) || d.references.length !== 3) throw new Error("Point through three planes needs exactly three planes."); d.references.forEach(plane); return; }
  if (d.method === "center") { axis(d.axis, "Point at centre"); return; }
  if (d.method === "edge-plane") { axis(d.axis, "Point at edge and plane"); plane(d.reference); return; }
  if (d.method === "along-path") { axis(d.axis, "Point along path"); if ((d.axis as AxisReference).lengthMillimeters === undefined) throw new Error("Point along path needs a straight edge with a length."); if (!Number.isFinite(d.t) || d.t < 0 || d.t > 1) throw new Error("The path fraction must be between 0 and 1."); return; }
  throw new Error("Unknown point method.");
}
