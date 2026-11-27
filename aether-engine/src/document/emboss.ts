import { validateSolidFaceReference, type SolidFaceReference } from "./solid-face-reference";

/** Wrap & Emboss (SolidCraft's `solid.emboss`): raises (emboss) or cuts (deboss) a
 *  sketch profile onto a planar or cylindrical face by `depthMillimeters`. */
export interface EmbossFeature {
  id: string;
  type: "emboss";
  name: string;
  suppressed: boolean;
  profileFeatureId: string;
  profileContourId?: string;
  face: SolidFaceReference;
  targetBodyId?: string;
  mode: "emboss" | "deboss";
  depthMillimeters: number;
  /** Optional lateral rotation on cylindrical wrap, in degrees. */
  angleDegrees?: number;
}

export function validateEmboss(
  feature: EmbossFeature,
  earlier: ReadonlyMap<string, string>,
  missing: (id: unknown) => boolean = () => false,
): void {
  const missingId = missing as (id: string) => boolean;
  if (typeof feature.profileFeatureId !== "string" || (!missing(feature.profileFeatureId) && !["profile", "sketch"].includes(earlier.get(feature.profileFeatureId) ?? ""))) {
    throw new Error("Emboss requires an earlier sketch.");
  }
  validateSolidFaceReference(feature.face, earlier, missingId, "Emboss face");
  if (feature.face.surfaceType !== undefined && feature.face.surfaceType !== "cylinder") {
    throw new Error("Emboss supports planar and cylindrical faces.");
  }
  if (feature.mode !== "emboss" && feature.mode !== "deboss") {
    throw new Error("Emboss mode must be 'emboss' or 'deboss'.");
  }
  if (typeof feature.depthMillimeters !== "number" || !Number.isFinite(feature.depthMillimeters) || feature.depthMillimeters <= 0) {
    throw new Error("Emboss depth must be positive.");
  }
  if (feature.angleDegrees !== undefined && (typeof feature.angleDegrees !== "number" || !Number.isFinite(feature.angleDegrees))) {
    throw new Error("Emboss angle must be finite.");
  }
}
