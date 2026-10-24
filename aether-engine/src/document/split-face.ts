import { validateMirrorPlane, type MirrorPlaneReference } from "./mirror-plane";
import { validateSolidFaceReference, type SolidFaceReference } from "./solid-face-reference";

/** Split Face (SolidCraft's solid.split_face): the picked faces of a part divided where a plane
 *  crosses them. The part keeps its shape and volume; it just has more faces to pick. */
export interface SplitFaceFeature {
  id: string; type: "split-face"; name: string; suppressed: boolean;
  targetBodyId: string;
  faces: SolidFaceReference[];
  plane: MirrorPlaneReference;
}
export function validateSplitFace(feature: SplitFaceFeature, earlier: ReadonlyMap<string, string>, missing: (id: string) => boolean): void {
  if (typeof feature.targetBodyId !== "string") throw new Error("Split face needs a target part.");
  if (!Array.isArray(feature.faces) || !feature.faces.length) throw new Error("Pick the faces to split.");
  for (const face of feature.faces) validateSolidFaceReference(face, earlier, missing, "Face to split");
  validateMirrorPlane(feature.plane, earlier, missing, "Split face plane");
}
