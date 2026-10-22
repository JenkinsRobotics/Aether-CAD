import type { AxisReference, PlaneReference, PointReference, ConstructionPlaneFeature } from "./construction-planes";
import { resolvePlaneFrame } from "./construction-planes";

/** Construction-axis semantics (SolidCraft's construct.axis.*): a line through
 *  a straight edge, through two points, square to a plane through a point, or
 *  where two planes meet. Picked geometry is captured at pick time, as the
 *  plane feature's references are. */
export type AxisDefinition =
  | { method: "edge"; axis: AxisReference }
  | { method: "two-points"; points: [PointReference, PointReference] }
  | { method: "normal-to-plane"; reference: PlaneReference; point: PointReference }
  | { method: "two-planes"; references: [PlaneReference, PlaneReference] };

export interface ConstructionAxisFeature {
  id: string;
  name: string;
  type: "axis";
  suppressed: boolean;
  definition: AxisDefinition;
}

export interface AxisLine { originMillimeters: [number, number, number]; directionMillimeters: [number, number, number] }
type V3 = [number, number, number];
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: readonly number[], what: string): V3 => { const l = Math.hypot(v[0], v[1], v[2]); if (!(l > 1e-9)) throw new Error(`${what} has no direction.`); return [v[0] / l, v[1] / l, v[2] / l]; };

export function resolveAxisLine(feature: ConstructionAxisFeature, earlier: readonly { id: string; type: string }[] = []): AxisLine {
  const d = feature.definition;
  const frameOf = (reference: PlaneReference) => {
    if (reference.kind === "principal") return resolvePlaneFrame({ id: "", name: "", type: "plane", plane: reference.plane, offsetMillimeters: 0, suppressed: false }, []);
    if (reference.kind === "face") return reference.frame;
    const index = earlier.findIndex((f) => f.id === reference.featureId), target = index >= 0 ? earlier[index] : undefined;
    if (!target || target.type !== "plane") throw new Error(`${feature.name}: plane references must be earlier construction planes.`);
    return resolvePlaneFrame(target as ConstructionPlaneFeature, earlier.slice(0, index));
  };
  if (d.method === "edge") return { originMillimeters: [...d.axis.originMillimeters], directionMillimeters: unit(d.axis.directionMillimeters, `${feature.name}: edge`) };
  if (d.method === "two-points") {
    const [a, b] = d.points.map((p) => p.positionMillimeters);
    return { originMillimeters: [...a] as V3, directionMillimeters: unit(sub(b, a), `${feature.name}: the two points coincide and`) };
  }
  if (d.method === "normal-to-plane") {
    const frame = frameOf(d.reference);
    return { originMillimeters: [...d.point.positionMillimeters], directionMillimeters: unit(frame.normal, `${feature.name}: plane`) };
  }
  const [a, b] = d.references.map(frameOf);
  const direction = cross(a.normal, b.normal);
  if (Math.hypot(...direction) < 1e-9) throw new Error(`${feature.name}: the two planes are parallel and do not meet.`);
  // A point on both planes: solve from a's origin along the direction square to the line within a.
  const u = unit(direction, `${feature.name}: planes`), inA = cross(a.normal, u);
  const t = dot(sub(b.originMillimeters, a.originMillimeters), b.normal) / dot(inA, b.normal);
  const origin: V3 = [a.originMillimeters[0] + inA[0] * t, a.originMillimeters[1] + inA[1] * t, a.originMillimeters[2] + inA[2] * t];
  return { originMillimeters: origin, directionMillimeters: u };
}

export function validateAxisDefinition(feature: ConstructionAxisFeature, earlierPlanes: ReadonlySet<string>, missing: (id: unknown) => boolean = () => false): void {
  const d = feature.definition;
  const v3 = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  const point = (p: unknown) => { const q = p as PointReference; if (!q || q.kind !== "point" || typeof q.partId !== "string" || typeof q.candidateId !== "string" || !v3(q.positionMillimeters)) throw new Error("Axis points must be picked vertices or sketch points."); };
  const plane = (r: unknown) => {
    const p = r as PlaneReference;
    if (!p || typeof p !== "object") throw new Error("Axis needs a plane reference.");
    if (p.kind === "principal") { if (!["XY", "XZ", "YZ"].includes(p.plane)) throw new Error("Invalid principal plane."); return; }
    if (p.kind === "feature") { if (typeof p.featureId !== "string" || (!earlierPlanes.has(p.featureId) && !missing(p.featureId))) throw new Error("Axis plane references must be earlier construction planes."); return; }
    if (p.kind === "face") { if (typeof p.partId !== "string" || !Number.isInteger(p.faceId) || !p.frame || !v3(p.frame.normal) || !v3(p.frame.originMillimeters) || !v3(p.frame.xDirection)) throw new Error("Invalid face reference."); return; }
    throw new Error("Invalid plane reference.");
  };
  if (!d || typeof d !== "object") throw new Error("Axis needs a definition.");
  if (d.method === "edge") { if (!d.axis || d.axis.kind !== "axis" || !v3(d.axis.originMillimeters) || !v3(d.axis.directionMillimeters) || Math.hypot(...d.axis.directionMillimeters) < 1e-9) throw new Error("Axis through edge needs a picked straight edge."); return; }
  if (d.method === "two-points") { if (!Array.isArray(d.points) || d.points.length !== 2) throw new Error("Axis through two points needs exactly two points."); d.points.forEach(point); return; }
  if (d.method === "normal-to-plane") { plane(d.reference); point(d.point); return; }
  if (d.method === "two-planes") { if (!Array.isArray(d.references) || d.references.length !== 2) throw new Error("Axis through two planes needs exactly two planes."); d.references.forEach(plane); return; }
  throw new Error("Unknown axis method.");
}
