import {validateSolidFaceReference,type SolidFaceReference} from "./solid-face-reference";
import {isHoleThreadStandard, threadSpecification, type HoleClearanceFit, type HoleThreadStandard} from "./hole-standards";

/** Where a hole starts: a point on a picked planar face (SolidCraft's `position` on a face). */
export interface HoleFacePlacement { kind: "face-point"; face: SolidFaceReference; pointMillimeters: [number, number, number] }

/** A standard screw thread the hole is made for (FreeCAD's Hole profile).
 *  `tapped` holes are drilled at the tap drill and carry the thread, cosmetic
 *  unless `modeled`; clearance holes take the fit's diameter. */
export interface HoleThread {
  standard: HoleThreadStandard;
  /** "M8", "M10x1.25", "1/4-20". */
  designation: string;
  tapped: boolean;
  /** Clearance fit for a hole that is not tapped; default normal. */
  fit?: HoleClearanceFit;
  /** Cut the helical thread into the wall instead of recording it; default false. */
  modeled?: boolean;
  leftHand?: boolean;
  /** Thread length from the start face; default: the whole hole. */
  depthMillimeters?: number;
}

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
  /** The drilled diameter. With a thread this is the tap drill or clearance size the standard gives. */
  diameterMillimeters: number; depthMillimeters: number;
  depthType: "blind" | "through-all";
  /** Counterdrill: a counterbore whose floor is the countersink cone down to the hole. */
  cutType: "plain" | "counterbore" | "countersink" | "counterdrill";
  counterDiameterMillimeters?: number; counterDepthMillimeters?: number;
  countersinkAngleDegrees?: number; reversed?: boolean;
  thread?: HoleThread;
  /** A blind hole's bottom: flat (default) or a drill-point cone below the depth. */
  drillPoint?: "flat" | "angled";
  /** Included angle of the drill point; default 118°. */
  drillPointAngleDegrees?: number;
  /** Half-angle taper of the drilled wall, narrowing with depth. */
  taperAngleDegrees?: number;
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
  if (!["blind", "through-all"].includes(feature.depthType) || !["plain", "counterbore", "countersink", "counterdrill"].includes(feature.cutType)) throw new Error("Invalid hole type.");
  if (feature.reversed !== undefined && typeof feature.reversed !== "boolean") throw new Error("Invalid hole direction.");
  if (feature.cutType !== "plain" && (!positive(feature.counterDiameterMillimeters) || feature.counterDiameterMillimeters! <= feature.diameterMillimeters))
    throw new Error("Head diameter must exceed the hole diameter.");
  if ((feature.cutType === "counterbore" || feature.cutType === "counterdrill") && (!positive(feature.counterDepthMillimeters) || feature.depthType === "blind" && feature.counterDepthMillimeters! >= feature.depthMillimeters))
    throw new Error("Counterbore depth must be positive and less than a blind hole's depth.");
  if ((feature.cutType === "countersink" || feature.cutType === "counterdrill") && (!positive(feature.countersinkAngleDegrees) || feature.countersinkAngleDegrees! >= 180))
    throw new Error("Countersink angle must be between 0 and 180 degrees.");
  if (feature.drillPoint !== undefined && !["flat", "angled"].includes(feature.drillPoint)) throw new Error("Invalid drill point.");
  if (feature.drillPointAngleDegrees !== undefined && !(positive(feature.drillPointAngleDegrees) && feature.drillPointAngleDegrees < 180)) throw new Error("Drill point angle must be between 0 and 180 degrees.");
  if (feature.taperAngleDegrees !== undefined) {
    if (!(typeof feature.taperAngleDegrees === "number" && Number.isFinite(feature.taperAngleDegrees) && feature.taperAngleDegrees >= 0 && feature.taperAngleDegrees < 45)) throw new Error("Hole taper must be between 0 and 45 degrees.");
    if (feature.depthType === "blind" && feature.depthMillimeters * Math.tan(feature.taperAngleDegrees * Math.PI / 180) >= feature.diameterMillimeters / 2) throw new Error("Hole taper closes the hole before its depth.");
  }
  if (feature.thread !== undefined) validateHoleThread(feature);
}

function validateHoleThread(feature: HoleFeature): void {
  const thread = feature.thread!;
  if (typeof thread !== "object" || thread === null || !isHoleThreadStandard(thread.standard) || typeof thread.designation !== "string") throw new Error("Hole thread needs a known standard and designation.");
  const spec = threadSpecification(thread.standard, thread.designation);
  if (!spec) throw new Error(`Unknown ${thread.standard} thread size "${thread.designation}".`);
  if (typeof thread.tapped !== "boolean") throw new Error("Hole thread must say whether it is tapped.");
  if (spec.tappedOnly && !thread.tapped) throw new Error(`${spec.designation} is a pipe thread and is tapped only; choose a metric or unified thread for a clearance hole.`);
  if (thread.fit !== undefined && !["close", "normal", "loose"].includes(thread.fit)) throw new Error("Hole clearance fit must be close, normal or loose.");
  for (const key of ["modeled", "leftHand"] as const) if (thread[key] !== undefined && typeof thread[key] !== "boolean") throw new Error("Invalid hole thread option.");
  if (thread.depthMillimeters !== undefined && !(Number.isFinite(thread.depthMillimeters) && thread.depthMillimeters > 0)) throw new Error("Thread depth must be positive.");
  if (thread.tapped) {
    if (feature.diameterMillimeters >= spec.majorDiameterMillimeters) throw new Error(`A ${spec.designation} tapped hole must be drilled under ${spec.majorDiameterMillimeters} mm.`);
    if (thread.depthMillimeters !== undefined && feature.depthType === "blind" && thread.depthMillimeters > feature.depthMillimeters) throw new Error("Thread depth cannot exceed the hole depth.");
    if (thread.modeled && feature.taperAngleDegrees) throw new Error("A modelled thread needs a straight (untapered) hole.");
  } else if (thread.modeled) throw new Error("Only a tapped hole can carry a modelled thread.");
}
