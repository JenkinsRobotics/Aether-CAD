/** Persistent Hole intent. Geometry is evaluated only by the native adapter. */
export interface HoleFeature {
  id: string; type: "hole"; name: string; suppressed: boolean;
  profileFeatureId: string; profileContourId?: string; targetBodyId?: string;
  diameterMillimeters: number; depthMillimeters: number;
  depthType: "blind" | "through-all";
  cutType: "plain" | "counterbore" | "countersink";
  counterDiameterMillimeters?: number; counterDepthMillimeters?: number;
  countersinkAngleDegrees?: number; reversed?: boolean;
}

export function validateHole(feature: HoleFeature, earlier: Map<string, string>, missing: (id: unknown) => boolean): void {
  const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;
  if (typeof feature.profileFeatureId !== "string" || (!missing(feature.profileFeatureId) && !["sketch", "profile"].includes(earlier.get(feature.profileFeatureId) ?? "")))
    throw new Error("Hole must reference an earlier circular sketch region.");
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
