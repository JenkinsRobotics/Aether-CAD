import { regenerateDimensionExpressions } from "../sketch/operations/dimension-expression";
import { validatePartDocument, type PartDocument } from "./part-document";
import { evaluateDocumentVariables, type DocumentVariable } from "./variables";
import { authoredTextDrawing } from "./text-expressions";
import { regenerateSketchTextExpressions } from "../sketch/text/regenerate-expressions";
import { resolveProfileDrawing } from "./profile-projection";
import type { ProfileFeature } from "./solid-features";
import { insertFeature } from "./feature-history";
import { withPierceContext } from '../../../freecad-engine/browser/pierce-context';
import { regenerateUnavailableSketch } from '../../../freecad-engine/browser/regenerate-unavailable-sketch';
import { featureReferenceErrors } from './feature-errors';

/** Atomic document transaction, including suppressed and rolled-back sketches.
 * Feature order makes updated source geometry available to downstream projections.
 * No caller-owned variables or geometry may change while fonts are awaited. */
export async function updatePartDocumentVariables(
  source: PartDocument,
  variables: readonly DocumentVariable[] | undefined,
  /** Optional sketch draft committed in the same transaction as its variables. */
  profile?: ProfileFeature,
): Promise<PartDocument> {
  validatePartDocument(source);
  let next = structuredClone(source);
  if (profile) {
    const draft = structuredClone(profile);
    const existing = next.features.find((feature) => feature.id === draft.id);
    if (existing && existing.type !== "profile")
      throw Error("The sketch draft ID belongs to another feature.");
    if (!existing) {
      // Use canonical insertion/rollback/body bookkeeping before introducing
      // formulas whose new variable definitions are not committed yet.
      next = insertFeature(next, {
        ...draft,
        profile: { type: "drawing", contours: [] },
      });
    }
    next.features = next.features.map((feature) =>
      feature.id === draft.id ? draft : feature,
    );
  }
  if (variables === undefined) delete next.variables;
  else next.variables = structuredClone([...variables]);
  const resolved = evaluateDocumentVariables(next.variables);
  for (const feature of next.features) {
    const drawing = authoredTextDrawing(feature);
    if (
      !drawing ||
      (!drawing.textItems?.some((item) => item.expression !== undefined) &&
        !drawing.constraints?.some((c) => c.valueExpression !== undefined))
    )
      continue;
    if (feature.type !== "profile") continue;
    const history = next.features.map(candidate => candidate.type === 'profile' ? { ...candidate, suppressed: false } : candidate);
    if (featureReferenceErrors({ ...next, features: history, rollbackIndex: undefined }).has(feature.id)) {
      const regenerated = await regenerateUnavailableSketch(drawing, resolved);
      if (feature.profile.type === 'drawing') feature.profile = regenerated;
      else if (feature.profile.type === 'projection') feature.profile.authored = regenerated;
      continue;
    }
    let input = drawing;
    if (feature.profile.type === "projection") {
      // Resolve just the reference geometry, not the old authored constraints.
      const references = resolveProfileDrawing(
        next.features.map((candidate) =>
          candidate.type === "profile"
            ? {
                ...candidate,
                suppressed: false,
                ...(candidate.id === feature.id &&
                candidate.profile.type === "projection"
                  ? { profile: { ...candidate.profile, authored: undefined } }
                  : {}),
              }
            : candidate,
        ),
        feature.id,
      );
      input = { ...drawing, projectionContext: references.contours };
    }
    // Suppression disables feature evaluation, not editing its dimensional
    // expressions. Resolve the same unsuppressed history used for projections.
    input=withPierceContext(next.features.map(candidate=>candidate.type==='profile'?{...candidate,suppressed:false}:candidate),feature.id,input);
    const regenerated = regenerateDimensionExpressions(
      await regenerateSketchTextExpressions(input, resolved),
      resolved,
    );
    delete regenerated.projectionContext;
    delete regenerated.pierceContext;
    if (feature.profile.type === "drawing") feature.profile = regenerated;
    else if (feature.profile.type === "projection")
      feature.profile.authored = regenerated;
  }
  validatePartDocument(next);
  // Rewording replaces glyph edge identities. Reject orphaned downstream
  // projections even when they contain no text or authored constraints.
  const allHistory = next.features.map((feature) =>
    feature.type === "profile" ? { ...feature, suppressed: false } : feature,
  );
  const unavailable = featureReferenceErrors({ ...next, features: allHistory, rollbackIndex: undefined });
  for (const feature of allHistory) {
    if (!unavailable.has(feature.id) && feature.type === "profile" && feature.profile.type === "projection")
      resolveProfileDrawing(allHistory, feature.id);
  }
  return next;
}
