import { flipSketchFrame, profileSketchFrame, rollbackPosition, validatePartDocument, type PartDocument, type ProfileFeature } from "@aether/core/document";
import { validateModelProjection, type ModelProjectionOptions, type SketchDrawing } from "@aether/core/sketch";
import type { ImportedModelData } from "../domain";
import type { AgentTool } from "@aether/ui/AgentServices";
import { appendModelContours, modelBeforeSketch, type ModelIncludeKernel } from "../sketch/model-include";
import { resolveSketchFrames } from "../modeling/sketch-support";

export const modelProjectionTool: AgentTool = {
  name: "aether_cad_sketch_include_model",
  description: "Project evaluated model edges, face boundaries or vertices into an existing editable sketch as independent copies. Omitted entities_json includes all earlier exact-body edges, not a silhouette. Does not create associative links. Analytic curves stay exact; other curves use tolerance_mm and are reported. Inspect current topology IDs before selecting. Rebuild and commit atomically.",
  inputSchema: {
    type: "object", additionalProperties: false, required: ["feature_id"],
    properties: {
      feature_id: { type: "string" },
      entities_json: { type: "string", description: 'JSON array of {body_id,face_id?,edge_index?,vertex?:"a"|"b"}. Edge requires face_id; vertex requires edge_index. Body selection includes boundary edges; face selection includes its loops. IDs come from current evaluated topology, not saved positional references.' },
      construction: { type: "boolean" },
      tolerance_mm: { type: "number", minimum: 0.00001, maximum: 1 },
    },
  },
};

function editableDrawing(feature: ProfileFeature): SketchDrawing {
  const profile = feature.profile;
  if (profile.type === "drawing") return structuredClone(profile);
  if (profile.type === "circle") return { type: "drawing", contours: [{ type: "circle", center: [...profile.centerMillimeters], radius: profile.radiusMillimeters }] };
  if (profile.type === "polygon") {
    const points = profile.pointsMillimeters;
    return { type: "drawing", contours: [{ type: "path", start: [...points[0]], segments: [...points.slice(1), points[0]].map(end => ({ type: "line", end: [...end] })) }] };
  }
  throw Error("Include model geometry requires an editable sketch, not a linked projection.");
}

export async function prepareModelProjection(
  source: PartDocument,
  args: Record<string, unknown>,
  kernel: Pick<ModelIncludeKernel, "projectModelGeometry"> & { evaluatePart(document: PartDocument): Promise<ImportedModelData> },
) {
  validatePartDocument(source);
  if (Object.keys(args).some(key => !["feature_id", "entities_json", "construction", "tolerance_mm"].includes(key))) throw Error("Unknown model projection argument.");
  if (rollbackPosition(source) !== source.features.length) throw Error("Move the rollback bar to the end before agent editing.");
  if (source.features.length > 512) throw Error("Agent editing supports at most 512 features.");
  if (args.construction !== undefined && typeof args.construction !== "boolean") throw Error("Construction must be boolean.");
  const index = source.features.findIndex(feature => feature.id === args.feature_id);
  const feature = source.features[index];
  if (feature?.type !== "profile" || feature.suppressed) throw Error("Choose an existing unsuppressed editable sketch feature_id.");
  const drawing = editableDrawing(feature);
  const options: ModelProjectionOptions = {};
  if (args.entities_json !== undefined) {
    if (typeof args.entities_json !== "string" || new TextEncoder().encode(args.entities_json).length > 65536) throw Error("Use entities_json of at most 64 KiB.");
    options.entities = JSON.parse(args.entities_json);
  }
  if (args.tolerance_mm !== undefined) options.toleranceMillimeters = args.tolerance_mm as number;
  validateModelProjection(flipSketchFrame(profileSketchFrame(feature), feature.flip), options);
  let resolved = structuredClone(source);
  if (feature.support) {
    // Resolve an attached face in the model at this feature, before using its
    // cached frame. Downstream features cannot change the source support.
    const prefix = { ...resolved, features: resolved.features.slice(0, index + 1) };
    const model = await kernel.evaluatePart(prefix);
    const updated = resolveSketchFrames(prefix, model.sketchFrames);
    resolved.features[index] = updated.features[index];
  }
  const target = resolved.features[index] as ProfileFeature;
  const frame = flipSketchFrame(profileSketchFrame(target), target.flip);
  validateModelProjection(frame, options);
  const projected = await kernel.projectModelGeometry(modelBeforeSketch(resolved, feature.id), frame, options);
  target.profile = appendModelContours(drawing, projected.contours, args.construction === true);
  validatePartDocument(resolved);
  return {
    document: resolved,
    featureID: feature.id,
    projection: { added_contours: projected.contours.length, associative: false, approximated_edges: projected.approximatedEdges, tolerance_mm: projected.toleranceMillimeters },
  };
}
