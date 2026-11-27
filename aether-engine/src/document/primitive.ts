/** Direct 3D Solid Primitives (SolidCraft's `solid.box`, `solid.cylinder`, `solid.sphere`,
 *  `solid.cone`, `solid.torus`): create exact analytic solids directly in 3D space without
 *  requiring an intermediate sketch, optionally combined with an existing target body. */
export type PrimitiveKind = "box" | "cylinder" | "sphere" | "cone" | "torus";

export interface PrimitiveFeature {
  id: string;
  type: "primitive";
  name: string;
  suppressed: boolean;
  kind: PrimitiveKind;
  operation: "new" | "add" | "cut" | "intersect";
  bodyId?: string;
  targetBodyId?: string;
  /** Origin point in world mm (default [0, 0, 0]). */
  originMillimeters?: [number, number, number];
  /** Principal orientation axis for cylinder/cone/torus/box (default "Z"). */
  axis?: "X" | "Y" | "Z";
  /** Optional custom unit/non-zero orientation axis vector (overrides `axis`). */
  direction?: [number, number, number];
  /** Box: center around origin in X, Y, Z instead of corner at origin (default true). */
  centered?: boolean;
  /** Box dimensions (mm). */
  widthMillimeters?: number;
  depthMillimeters?: number;
  heightMillimeters?: number;
  /** Cylinder / Sphere radius (mm). */
  radiusMillimeters?: number;
  /** Cone bottom & top radii (mm); topRadius = 0 gives a sharp cone, > 0 gives a frustum. */
  bottomRadiusMillimeters?: number;
  topRadiusMillimeters?: number;
  /** Torus major & minor radii (mm). */
  majorRadiusMillimeters?: number;
  minorRadiusMillimeters?: number;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pos = (v: unknown, label: string) => {
  if (!finite(v) || v <= 0) throw new Error(`${label} must be positive.`);
};

export function validatePrimitive(feature: PrimitiveFeature): void {
  if (!["box", "cylinder", "sphere", "cone", "torus"].includes(feature.kind)) {
    throw new Error("Primitive kind must be box, cylinder, sphere, cone, or torus.");
  }
  if (!["new", "add", "cut", "intersect"].includes(feature.operation)) {
    throw new Error("Primitive operation must be new, add, cut, or intersect.");
  }
  if (feature.originMillimeters !== undefined) {
    if (!Array.isArray(feature.originMillimeters) || feature.originMillimeters.length !== 3 || !feature.originMillimeters.every(finite)) {
      throw new Error("Primitive origin must be three finite coordinates in mm.");
    }
  }
  if (feature.axis !== undefined && !["X", "Y", "Z"].includes(feature.axis)) {
    throw new Error("Primitive axis must be X, Y, or Z.");
  }
  if (feature.direction !== undefined) {
    if (!Array.isArray(feature.direction) || feature.direction.length !== 3 || !feature.direction.every(finite) || Math.hypot(...feature.direction) < 1e-9) {
      throw new Error("Primitive direction must be a non-zero 3D vector.");
    }
  }
  switch (feature.kind) {
    case "box":
      pos(feature.widthMillimeters, "Box width");
      pos(feature.depthMillimeters, "Box depth");
      pos(feature.heightMillimeters, "Box height");
      break;
    case "cylinder":
      pos(feature.radiusMillimeters, "Cylinder radius");
      pos(feature.heightMillimeters, "Cylinder height");
      break;
    case "sphere":
      pos(feature.radiusMillimeters, "Sphere radius");
      break;
    case "cone": {
      const r0 = feature.bottomRadiusMillimeters ?? 0;
      const r1 = feature.topRadiusMillimeters ?? 0;
      if (!finite(r0) || r0 < 0 || !finite(r1) || r1 < 0 || (r0 === 0 && r1 === 0)) {
        throw new Error("Cone needs non-negative radii with at least one positive radius.");
      }
      pos(feature.heightMillimeters, "Cone height");
      break;
    }
    case "torus":
      pos(feature.majorRadiusMillimeters, "Torus major radius");
      pos(feature.minorRadiusMillimeters, "Torus minor radius");
      if ((feature.minorRadiusMillimeters ?? 0) >= (feature.majorRadiusMillimeters ?? 0)) {
        throw new Error("Torus minor radius must be smaller than major radius.");
      }
      break;
  }
}
