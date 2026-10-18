import {resolveExtrusionScopes} from './modeling/extrusion-scope-resolution';
import { FeatureBuildError } from "./modeling/feature-errors";
import type { ImportedModelData } from "./domain";
import type { PartDocument } from "./part-document";
import { translateDocument } from "./freecad-translate";
import { buildWithFreeCAD } from "./freecad-geometry";
import { resolveSketchFrames } from "./modeling/sketch-support";
import { resolveBodyOutputs } from "./modeling/body-outputs";
import { availableBodies } from "@aether/core/document";


/** Product-owned native evaluation shared by the app and compact test window. */
export async function evaluateNativePart(document: PartDocument, options: { preview?: boolean } = {}): Promise<ImportedModelData> {
  const started = performance.now();
  const translation = translateDocument(document);
  if (!translation.complete) {
    throw new FeatureBuildError(new Map(translation.untranslated.map(item => [item.id, item.reason])), translation.untranslated.map(item => `${item.name}: ${item.reason}`).join("\n"));
  }
  // Translation has already applied DOCUMENT rollback. Its engine feature
  // count differs when a sketch contains several contours.
  const last = document.features[(document.rollbackIndex ?? document.features.length) - 1];
  const previewFeatureId = options.preview && last && !last.suppressed && !["sketch","profile","plane"].includes(last.type) && translation.features.at(-1)?.id === last.id ? last.id : undefined;
  const build = await buildWithFreeCAD(translation.features, {previewFeatureId});
  const failures = build.diagnostics.filter(item => item.severity === "error");
  if (build.status !== "ok" || failures.length) {
    const names = new Map(document.features.map(f => [f.id, f.name]));
    const sourceId = (id: string) => document.features.find(f => f.id === id)?.id
      ?? document.features.find(f => translation.features.some(t => t.id === id && (t.parameters.source_profile_id === f.id || id.startsWith(`${f.id}#`))))?.id ?? id;
    throw new FeatureBuildError(new Map(failures.map(item => [sourceId(item.feature_id), item.message])), failures.map(item => `${names.get(item.feature_id) ?? item.feature_id}: ${item.message}`).join("\n") || build.message || "Failed to rebuild Part.");
  }
  const resolved = resolveExtrusionScopes(resolveBodyOutputs(resolveSketchFrames(document, build.sketchFrames), build.bodyOutputs),build.scopeResolutions);
  const bodies = availableBodies(resolved);
  if (bodies.length !== build.parts.length) throw new Error("Rebuild returned an unexpected number of bodies. Check the profile, target and engine compatibility.");
  const returnedIds = build.parts.map((part, index) => part.id.startsWith("freecad:") ? bodies[index]?.id : part.id);
  if (new Set(returnedIds).size !== bodies.length || returnedIds.some(id => !bodies.some(body => body.id === id))) throw new Error("Rebuild returned unexpected body identities.");
  return {
    featurePreview: build.featurePreview,
    featurePreviewUnavailable: !!previewFeatureId && !build.featurePreview,
    bodyOutputs: build.bodyOutputs,
    scopeResolutions: build.scopeResolutions,
    sketchFrames: build.sketchFrames,
    sourceName: document.name,
    parseMilliseconds: performance.now() - started,
    parts: build.parts.map((part, index) => ({
      ...part,
      id: part.id.startsWith("freecad:") ? (bodies[index]?.id ?? part.id) : part.id,
      name: bodies.find(body => body.id === part.id)?.name ?? bodies[index]?.name ?? part.name,
      sourceDocumentId: document.documentId,
      sourceName: document.name,
    })),
  };
}
