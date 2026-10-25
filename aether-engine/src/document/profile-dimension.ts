import { editDrawingDimension } from "../sketch/operations/edit-dimension";
import { withPierceContext } from "../sketch/reference/pierce-context";
import { withDocumentDistanceIntent } from "./distance-intent";
import { validatePartDocument, type PartDocument } from "./part-document";
import { resolveProfileDrawing } from "./profile-projection";

/** The editor and saved/live agents share editDrawingDimension. This adapter
 * supplies document references, then removes derived context before saving. */
export function editProfileDimension(
  document: PartDocument,
  featureId: string,
  dimensionId: string,
  value: number,
): PartDocument {
  validatePartDocument(document);
  const next = withDocumentDistanceIntent(document);
  const feature = next.features.find(candidate => candidate.id === featureId);
  if (feature?.type !== "profile" || feature.suppressed)
    throw Error("Choose an unsuppressed profile sketch.");
  const profile = feature.profile;
  const drawing = profile.type === "drawing" ? profile
    : profile.type === "projection" ? profile.authored : undefined;
  const dimension = drawing?.constraints?.find(candidate => candidate.id === dimensionId);
  if (!drawing || !dimension || dimension.value === undefined || dimension.reference)
    throw Error("Choose an editable driving dimension from sketch_inspect.");

  let input = drawing;
  if (profile.type === "projection") {
    const references = resolveProfileDrawing(next.features.map(candidate =>
      candidate.id === featureId
        ? { ...feature, profile: { ...profile, authored: undefined } }
        : candidate), featureId);
    input = { ...drawing, projectionContext: references.contours };
  }
  input = withPierceContext(next.features, featureId, input);
  const solved = editDrawingDimension(input, dimensionId, value);
  delete solved.projectionContext;
  delete solved.pierceContext;
  if (profile.type === "projection") profile.authored = solved;
  else feature.profile = solved;
  validatePartDocument(next);
  return next;
}
