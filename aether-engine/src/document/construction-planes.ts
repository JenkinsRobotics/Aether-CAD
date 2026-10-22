import type { SketchFrame } from "../sketch/drawing";
import type { SketchPlane } from "../sketch/index";

/** Construction-plane semantics: how a plane feature derives its frame from
 * referenced entities. Legacy planes (no `definition`) remain a principal
 * plane plus normal offset. */

export type PlaneReference =
  | { kind: "principal"; plane: SketchPlane }
  | { kind: "feature"; featureId: string }
  /** A planar face on a solid. The frame is captured at pick time because face
   *  geometry lives in the kernel, not the document — the same thing
   *  ProfileFeature.frame does for a sketch on a face.
   *  ponytail: not re-resolved when upstream geometry rebuilds. Making that
   *  parametric is the topological-naming problem; it needs stable face ids
   *  from the evaluator, not a change here. */
  | { kind: "face"; partId: string; faceId: number; label?: string; frame: SketchFrame };

/** A picked vertex or exact topology point. Position captured at pick time,
 *  for the same reason a face reference captures its frame. */
export interface PointReference {
  kind: "point";
  partId: string;
  candidateId: string;
  label?: string;
  positionMillimeters: [number, number, number];
}

/** A picked edge, as an origin and a direction. */
export interface AxisReference {
  kind: "axis";
  partId: string;
  candidateId: string;
  label?: string;
  originMillimeters: [number, number, number];
  directionMillimeters: [number, number, number];
  /** The edge's length, when it is straight; lets a plane sit at a fraction along it. */
  lengthMillimeters?: number;
}

/** A point on a curved face with the surface normal there, captured at pick time. */
export interface SurfacePointReference {
  kind: "surface-point";
  partId: string;
  faceId: number;
  label?: string;
  pointMillimeters: [number, number, number];
  normalMillimeters: [number, number, number];
}

export type PlaneDefinition =
  | { method: "offset"; reference: PlaneReference; distanceMillimeters: number; flip?: boolean }
  | { method: "mid"; references: [PlaneReference, PlaneReference]; flip?: boolean }
  /** Onshape "Three point": the plane through three non-collinear points. */
  | { method: "three-point"; points: [PointReference, PointReference, PointReference]; flip?: boolean }
  /** Onshape "Angle": through an edge, at an angle to a reference plane. */
  | { method: "angle"; axis: AxisReference; reference: PlaneReference; angleDegrees: number; flip?: boolean }
  /** SolidCraft "Perpendicular Plane": holds the edge and is square to the reference plane. */
  | { method: "perpendicular"; axis: AxisReference; reference: PlaneReference; flip?: boolean }
  /** SolidCraft "Plane Through Two Edges": the plane two straight edges share. */
  | { method: "two-edges"; axes: [AxisReference, AxisReference]; flip?: boolean }
  /** SolidCraft "Tangent Plane": touches a curved face at the picked point. */
  | { method: "tangent"; surface: SurfacePointReference; flip?: boolean }
  /** SolidCraft "Plane Along Path": square to a straight edge at a fraction along it. */
  | { method: "along-path"; axis: AxisReference; t: number; flip?: boolean };

export interface ConstructionPlaneFeature {
  id: string;
  name: string;
  type: "plane";
  plane: SketchPlane;
  offsetMillimeters: number;
  suppressed: boolean;
  definition?: PlaneDefinition;
}

interface EarlierFeature {
  id: string;
  type: string;
}

/** The canonical in-plane X for a plane with this normal.
 *
 * A kernel face reports whatever X its own surface parameterization happens to
 * carry, so two coplanar faces built by different operations can hand back
 * different in-plane rotations — a sketch on a model face would come out
 * rotated against an identical sketch on a datum plane. This makes the choice
 * a property of the normal alone: project world +X onto the plane, falling back
 * to +Y when the normal is (anti)parallel to X.
 *
 * It reproduces every principal frame exactly (XY and XZ get +X, YZ gets +Y),
 * so datum planes, model faces and offset planes all share one convention.
 */
export function canonicalPlaneXDirection(
  normal: readonly [number, number, number],
): [number, number, number] {
  const length = Math.hypot(...normal);
  if (!length) return [1, 0, 0];
  const n = normal.map((c) => c / length) as [number, number, number];
  // |n · X| > 0.9 means X is too close to the normal to project usefully.
  const reference: [number, number, number] = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  const projection = reference.reduce((sum, c, i) => sum + c * n[i], 0);
  const x = reference.map((c, i) => c - projection * n[i]) as [number, number, number];
  const scale = Math.hypot(...x);
  return x.map((c) => {
    const v = c / scale;
    // Normalise -0 so frames compare cleanly.
    return v === 0 ? 0 : v;
  }) as [number, number, number];
}

export function principalFrame(plane: SketchPlane, offsetMillimeters = 0): SketchFrame {
  // Canonical = the kernel's named-plane table (replicad PLANES_CONFIG):
  // XY x[1,0,0] n[0,0,1] · XZ x[1,0,0] n[0,-1,0] · YZ x[0,1,0] n[1,0,0].
  // Display, sketch surfaces, and bodies all share this one convention.
  const n: [number, number, number] =
    plane === "XY" ? [0, 0, 1] : plane === "XZ" ? [0, -1, 0] : [1, 0, 0];
  return {
    originMillimeters: n.map((v) => v * offsetMillimeters) as [number, number, number],
    normal: n,
    xDirection: plane === "YZ" ? [0, 1, 0] : [1, 0, 0],
  };
}

/** Resolve the world frame of a plane feature. `earlier` holds the features
 * that precede it in the history; feature references resolve recursively
 * against their own earlier slices. */
export function resolvePlaneFrame(
  feature: ConstructionPlaneFeature,
  earlier: readonly EarlierFeature[] = [],
): SketchFrame {
  const definition = feature.definition;
  if (!definition) return principalFrame(feature.plane, feature.offsetMillimeters);
  const frameOf = (reference: PlaneReference): SketchFrame => {
    if (reference.kind === "principal") return principalFrame(reference.plane);
    if (reference.kind === "face") return reference.frame;
    const index = earlier.findIndex((f) => f.id === reference.featureId);
    const target = index >= 0 ? earlier[index] : undefined;
    if (!target || target.type !== "plane")
      throw new Error(`${feature.name}: plane references must be earlier construction planes.`);
    return resolvePlaneFrame(target as ConstructionPlaneFeature, earlier.slice(0, index));
  };
  const maybeFlip = (frame: SketchFrame): SketchFrame =>
    definition.flip
      ? { ...frame, normal: frame.normal.map((v) => -v) as [number, number, number] }
      : frame;
  if (definition.method === "offset") {
    if (!Number.isFinite(definition.distanceMillimeters))
      throw new Error(`${feature.name}: offset distance must be finite.`);
    const base = frameOf(definition.reference);
    return maybeFlip({
      originMillimeters: base.originMillimeters.map(
        (v, i) => v + base.normal[i] * definition.distanceMillimeters,
      ) as [number, number, number],
      normal: base.normal,
      xDirection: base.xDirection,
    });
  }
  if (definition.method === "three-point") {
    const [p, q, r] = definition.points.map((point) => point.positionMillimeters);
    const u = q.map((v, i) => v - p[i]) as [number, number, number];
    const v = r.map((value, i) => value - p[i]) as [number, number, number];
    const normal: [number, number, number] = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const length = Math.hypot(...normal);
    if (length < 1e-9)
      throw new Error(`${feature.name}: three point plane needs three non-collinear points.`);
    const unit = normal.map((c) => c / length) as [number, number, number];
    return maybeFlip({
      originMillimeters: p,
      normal: unit,
      // Canonical, so a three-point plane aligns like every other plane.
      xDirection: canonicalPlaneXDirection(unit),
    });
  }
  if (definition.method === "angle") {
    if (!Number.isFinite(definition.angleDegrees))
      throw new Error(`${feature.name}: plane angle must be finite.`);
    const axisLength = Math.hypot(...definition.axis.directionMillimeters);
    if (axisLength < 1e-9)
      throw new Error(`${feature.name}: the angle axis has no direction.`);
    const k = definition.axis.directionMillimeters.map((c) => c / axisLength) as [number, number, number];
    const base = frameOf(definition.reference);
    // Rotate the reference normal about the axis (Rodrigues). At 0° the plane
    // contains the axis and is parallel to the reference, as Onshape does.
    const theta = (definition.angleDegrees * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const n = base.normal;
    const dot = k[0] * n[0] + k[1] * n[1] + k[2] * n[2];
    if (Math.abs(dot) > 1e-7)
      throw new Error(`${feature.name}: the angle axis must be parallel to the reference plane.`);
    const cross: [number, number, number] = [
      k[1] * n[2] - k[2] * n[1],
      k[2] * n[0] - k[0] * n[2],
      k[0] * n[1] - k[1] * n[0],
    ];
    const rotated = n.map(
      (c, i) => c * cos + cross[i] * sin + k[i] * dot * (1 - cos),
    ) as [number, number, number];
    const length = Math.hypot(...rotated);
    if (length < 1e-9)
      throw new Error(`${feature.name}: the angle axis is parallel to the reference normal.`);
    const unit = rotated.map((c) => c / length) as [number, number, number];
    return maybeFlip({
      originMillimeters: definition.axis.originMillimeters,
      normal: unit,
      xDirection: canonicalPlaneXDirection(unit),
    });
  }
  const unitOf = (v: readonly number[], what: string): [number, number, number] => { const l = Math.hypot(v[0], v[1], v[2]); if (l < 1e-9) throw new Error(`${feature.name}: ${what} has no direction.`); return [v[0] / l, v[1] / l, v[2] / l]; };
  const crossOf = (u: readonly number[], v: readonly number[]): [number, number, number] => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  if (definition.method === "perpendicular") {
    const d = unitOf(definition.axis.directionMillimeters, "the edge"), base = frameOf(definition.reference);
    const normal = crossOf(d, base.normal), length = Math.hypot(...normal);
    if (length < 1e-9) throw new Error(`${feature.name}: the edge is square to the reference plane already; choose another plane.`);
    const unit = normal.map((c) => c / length) as [number, number, number];
    return maybeFlip({ originMillimeters: [...definition.axis.originMillimeters], normal: unit, xDirection: canonicalPlaneXDirection(unit) });
  }
  if (definition.method === "two-edges") {
    const [a, b] = definition.axes, da = unitOf(a.directionMillimeters, "the first edge"), db = unitOf(b.directionMillimeters, "the second edge");
    let normal = crossOf(da, db);
    if (Math.hypot(...normal) < 1e-9) normal = crossOf(da, [b.originMillimeters[0] - a.originMillimeters[0], b.originMillimeters[1] - a.originMillimeters[1], b.originMillimeters[2] - a.originMillimeters[2]]);
    const length = Math.hypot(...normal);
    if (length < 1e-9) throw new Error(`${feature.name}: the two edges lie on one line and do not define a plane.`);
    const unit = normal.map((c) => c / length) as [number, number, number];
    const gap = (b.originMillimeters[0] - a.originMillimeters[0]) * unit[0] + (b.originMillimeters[1] - a.originMillimeters[1]) * unit[1] + (b.originMillimeters[2] - a.originMillimeters[2]) * unit[2];
    if (Math.abs(gap) > 1e-6) throw new Error(`${feature.name}: the two edges are not in one plane.`);
    return maybeFlip({ originMillimeters: [...a.originMillimeters], normal: unit, xDirection: canonicalPlaneXDirection(unit) });
  }
  if (definition.method === "tangent") {
    const unit = unitOf(definition.surface.normalMillimeters, "the surface normal");
    return maybeFlip({ originMillimeters: [...definition.surface.pointMillimeters], normal: unit, xDirection: canonicalPlaneXDirection(unit) });
  }
  if (definition.method === "along-path") {
    const d = unitOf(definition.axis.directionMillimeters, "the path");
    if (!Number.isFinite(definition.t) || definition.t < 0 || definition.t > 1) throw new Error(`${feature.name}: the path fraction must be between 0 and 1.`);
    const length = definition.axis.lengthMillimeters ?? 0;
    const o = definition.axis.originMillimeters, along = (definition.t - 0.5) * length;
    return maybeFlip({ originMillimeters: [o[0] + d[0] * along, o[1] + d[1] * along, o[2] + d[2] * along], normal: d, xDirection: canonicalPlaneXDirection(d) });
  }
  const [a, b] = definition.references.map(frameOf);
  const alignment =
    a.normal[0] * b.normal[0] + a.normal[1] * b.normal[1] + a.normal[2] * b.normal[2];
  if (Math.abs(alignment) < 1 - 1e-6)
    throw new Error(`${feature.name}: mid plane needs two parallel planes.`);
  const gap =
    (b.originMillimeters[0] - a.originMillimeters[0]) * a.normal[0] +
    (b.originMillimeters[1] - a.originMillimeters[1]) * a.normal[1] +
    (b.originMillimeters[2] - a.originMillimeters[2]) * a.normal[2];
  // Midway along A's normal; keeps A's in-plane axes for determinism.
  return maybeFlip({
    originMillimeters: a.originMillimeters.map(
      (v, i) => v + (a.normal[i] * gap) / 2,
    ) as [number, number, number],
    normal: a.normal,
    xDirection: a.xDirection,
  });
}

/** Structural validation; geometric checks (e.g. mid-plane parallelism)
 * surface at frame resolution. `earlierPlaneIds` are construction planes
 * preceding this feature in the history. */
export function validatePlaneDefinition(
  feature: ConstructionPlaneFeature,
  earlierPlaneIds: ReadonlySet<string>,
  missingReference: (id: unknown) => boolean = () => false,
): void {
  const definition = feature.definition;
  if (definition === undefined) return;
  const checkReference = (reference: PlaneReference) => {
    if (reference.kind === "principal") {
      if (!["XY", "XZ", "YZ"].includes(reference.plane))
        throw new Error("Invalid principal plane reference.");
    } else if (reference.kind === "face") {
      const frame = reference.frame;
      const finite = (v: readonly number[] | undefined) =>
        Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
      if (
        typeof reference.partId !== "string" ||
        !Number.isInteger(reference.faceId) ||
        !frame ||
        !finite(frame.originMillimeters) ||
        !finite(frame.xDirection) ||
        !finite(frame.normal)
      )
        throw new Error("A face reference needs a part, a face and a captured frame.");
      if (!Math.hypot(...frame.normal))
        throw new Error("A face reference needs a non-degenerate normal.");
    } else if (
      reference.kind !== "feature" ||
      typeof reference.featureId !== "string" ||
      (!missingReference(reference.featureId) && !earlierPlaneIds.has(reference.featureId))
    )
      throw new Error("Plane references must point to earlier construction planes.");
  };
  if (definition.method === "three-point") {
    if (definition.points?.length !== 3)
      throw new Error("A three point plane needs exactly three points.");
    for (const point of definition.points)
      if (
        point?.kind !== "point" ||
        typeof point.partId !== "string" ||
        typeof point.candidateId !== "string" ||
        point.positionMillimeters?.length !== 3 ||
        !point.positionMillimeters.every(Number.isFinite)
      )
        throw new Error("A three point plane needs three picked points with positions.");
    return;
  }
  const checkAxis = (axis: AxisReference | undefined, what: string) => {
    if (axis?.kind !== "axis" || typeof axis.partId !== "string" || typeof axis.candidateId !== "string" || axis.originMillimeters?.length !== 3 || axis.directionMillimeters?.length !== 3 || !axis.originMillimeters.every(Number.isFinite) || !axis.directionMillimeters.every(Number.isFinite))
      throw new Error(`${what} needs a picked edge with an origin and direction.`);
    if (axis.lengthMillimeters !== undefined && !(Number.isFinite(axis.lengthMillimeters) && axis.lengthMillimeters > 0)) throw new Error(`${what} has an invalid edge length.`);
  };
  if (definition.method === "perpendicular") { checkAxis(definition.axis, "A perpendicular plane"); checkReference(definition.reference); return; }
  if (definition.method === "two-edges") { if (!Array.isArray(definition.axes) || definition.axes.length !== 2) throw new Error("A plane through two edges needs exactly two edges."); definition.axes.forEach((axis) => checkAxis(axis, "A plane through two edges")); return; }
  if (definition.method === "tangent") {
    const sp = definition.surface;
    if (sp?.kind !== "surface-point" || typeof sp.partId !== "string" || !Number.isInteger(sp.faceId) || sp.pointMillimeters?.length !== 3 || sp.normalMillimeters?.length !== 3 || !sp.pointMillimeters.every(Number.isFinite) || !sp.normalMillimeters.every(Number.isFinite) || !Math.hypot(...sp.normalMillimeters))
      throw new Error("A tangent plane needs a picked point on a face with its normal.");
    return;
  }
  if (definition.method === "along-path") { checkAxis(definition.axis, "A plane along a path"); if (definition.axis.lengthMillimeters === undefined) throw new Error("A plane along a path needs a straight edge with a length."); if (!Number.isFinite(definition.t) || definition.t < 0 || definition.t > 1) throw new Error("The path fraction must be between 0 and 1."); return; }
  if (definition.method === "angle") {
    const axis = definition.axis;
    if (
      axis?.kind !== "axis" ||
      typeof axis.partId !== "string" ||
      typeof axis.candidateId !== "string" ||
      axis.originMillimeters?.length !== 3 ||
      axis.directionMillimeters?.length !== 3 ||
      !axis.originMillimeters.every(Number.isFinite) ||
      !axis.directionMillimeters.every(Number.isFinite)
    )
      throw new Error("An angled plane needs a picked edge with an origin and direction.");
    if (!Number.isFinite(definition.angleDegrees))
      throw new Error("An angled plane needs a finite angle.");
    checkReference(definition.reference);
    return;
  }
  if (definition.method === "offset") {
    checkReference(definition.reference);
    if (!Number.isFinite(definition.distanceMillimeters))
      throw new Error("Plane offset distance must be finite.");
  } else if (definition.method === "mid") {
    if (!Array.isArray(definition.references) || definition.references.length !== 2)
      throw new Error("Mid plane needs exactly two references.");
    definition.references.forEach(checkReference);
  } else throw new Error("Unknown plane definition method.");
}

/** A half turn about the frame's own x ("x": y and the normal reverse) or y
 *  ("y": x and the normal reverse). The origin stays. */
export function flipSketchFrame(frame: SketchFrame, flip: "x" | "y" | undefined): SketchFrame {
  if (!flip) return frame;
  const neg = (v: [number, number, number]): [number, number, number] => [-v[0], -v[1], -v[2]];
  return { ...frame, normal: neg(frame.normal), xDirection: flip === "y" ? neg(frame.xDirection) : frame.xDirection };
}

/** The frame a sketch feature lies in as the UI knows it: its explicit frame
 *  (a face or plane it was started on) or its principal plane and offset, then
 *  its flip. The evaluator applies the same flip on top of a followed face. */
export function profileFrame(feature: { plane: SketchPlane; offsetMillimeters?: number; frame?: SketchFrame; flip?: "x" | "y" }): SketchFrame {
  return flipSketchFrame(feature.frame ?? principalFrame(feature.plane, feature.offsetMillimeters ?? 0), feature.flip);
}

