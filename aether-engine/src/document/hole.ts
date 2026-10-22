import {validateSolidFaceReference,type SolidFaceReference} from "./solid-face-reference";

/** Where a hole starts: a point on a picked planar face (SolidCraft's `position` on a face). */
export interface HoleFacePlacement { kind: "face-point"; face: SolidFaceReference; pointMillimeters: [number, number, number] }

/** Persistent Hole intent. Geometry is evaluated only by the native adapter. */
export interface HoleFeature {
  id: string; type: "hole"; name: string; suppressed: boolean;
  /** The centre sketch; absent when `placement` gives the hole its start. */
  profileFeatureId?: string; profileContourId?: string; targetBodyId?: string;
  /** One hole at every circle of the sketch instead of one chosen region. */
  allCircles?: boolean;
  placement?: HoleFacePlacement;
  /** Drill direction; default: into the part, square to the sketch or face. */
  direction?: [number, number, number];
  diameterMillimeters: number; depthMillimeters: number;
  depthType: "blind" | "through-all";
  cutType: "plain" | "counterbore" | "countersink";
  counterDiameterMillimeters?: number; counterDepthMillimeters?: number;
  countersinkAngleDegrees?: number; reversed?: boolean;
}

export function validateHole(feature: HoleFeature, earlier: Map<string, string>, missing: (id: unknown) => boolean): void {
  const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;
  if (feature.placement !== undefined) {
    const p = feature.placement;
    if (p.kind !== "face-point" || !Array.isArray(p.pointMillimeters) || p.pointMillimeters.length !== 3 || !p.pointMillimeters.every(Number.isFinite)) throw new Error("Hole placement needs a planar face and a point on it.");
    validateSolidFaceReference(p.face, earlier, missing as (id: string) => boolean, "Hole face");
    if (p.face.surfaceType) throw new Error("Hole face must be planar.");
  } else if (typeof feature.profileFeatureId !== "string" || (!missing(feature.profileFeatureId) && !["sketch", "profile"].includes(earlier.get(feature.profileFeatureId) ?? "")))
    throw new Error("Hole must reference an earlier circular sketch region, or a point on a face.");
  if (feature.allCircles !== undefined && typeof feature.allCircles !== "boolean") throw new Error("Invalid hole placement.");
  if (feature.direction !== undefined && !(Array.isArray(feature.direction) && feature.direction.length === 3 && feature.direction.every(Number.isFinite) && Math.hypot(...feature.direction) > 1e-9)) throw new Error("Hole direction must be a nonzero vector.");
  if (feature.profileContourId !== undefined && (typeof feature.profileContourId !== "string" || !feature.profileContourId.trim() || feature.profileContourId.length > 128)) throw new Error("Invalid hole contour reference.");
  if (!positive(feature.diameterMillimeters) || !positive(feature.depthMillimeters)) throw new Error("Hole diameter and depth must be positive.");
  if (!["blind", "through-all"].includes(feature.depthType) || !["plain", "counterbore", "countersink"].includes(feature.cutType)) throw new Error("Invalid hole type.");
  if (feature.reversed !== undefined && typeof feature.reversed !== "boolean") throw new Error("Invalid hole direction.");
  if (feature.cutType !== "plain" && (!positive(feature.counterDiameterMillimeters) || feature.counterDiameterMillimeters! <= feature.diameterMillimeters))
    throw new Error("Head diameter must exceed the hole diameter.");
  if (feature.cutType === "counterbore" && (!positive(feature.counterDepthMillimeters) || feature.depthType === "blind" && feature.counterDepthMillimeters! >= feature.depthMillimeters))
    throw new Error("Counterbore depth must be positive and less than a blind hole's depth.");
  if (feature.cutType === "countersink" && (!positive(feature.countersinkAngleDegrees) || feature.countersinkAngleDegrees! >= 180))
    throw new Error("Countersink angle must be between 0 and 180 degrees.");
}
