/** Part evaluation on the Aether engine (OCCT in-process), in the shape the
 *  app's evaluator seam expects. Shapes stay in the worker; meshes come back
 *  as transferred buffers. */
import { availableBodies } from "@aether/core/document";
import type { AnalysisOptions, ExportOptions, ImportedModelData, MeasureEntity } from "@aether/core/contracts";
import type { PartDocument } from "../../part-document";
import { FeatureBuildError } from "../../modeling/feature-errors";
import { resolveBodyOutputs } from "../../modeling/body-outputs";
import { resolveSketchFrames } from "../../modeling/sketch-support";
import { resolveExtrusionScopes } from "../../modeling/extrusion-scope-resolution";
import { EngineUnsupported } from "../unsupported";
import { aetherKernel } from "./kernel";

const ENGINE = "Aether";

/** Worker failures as the app's typed errors. */
function rethrow(error: unknown, document: PartDocument): never {
  const failure = error as { message?: string; featureId?: string; featureName?: string; unsupported?: boolean };
  if (failure?.unsupported && failure.featureId) throw new EngineUnsupported(ENGINE, failure.featureId, failure.message ?? "this feature");
  if (failure?.featureId) {
    const name = failure.featureName ?? document.features.find(f => f.id === failure.featureId)?.name ?? failure.featureId;
    const message = (failure.message ?? "").replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: `), "");
    throw new FeatureBuildError(new Map([[failure.featureId, message]]), `${name}: ${message}`);
  }
  throw error instanceof Error ? error : new Error(String(error));
}

export async function evaluateAetherPart(document: PartDocument, options: { preview?: boolean } = {}): Promise<ImportedModelData> {
  const started = performance.now();
  let model: ImportedModelData;
  try { model = await aetherKernel().evaluatePart(document, options); }
  catch (error) { rethrow(error, document); }
  const expected = availableBodies(resolveExtrusionScopes(resolveBodyOutputs(resolveSketchFrames(document, model.sketchFrames), model.bodyOutputs ?? {}), model.scopeResolutions ?? {}));
  // A preview carries only its overlay (base + the feature's material); the full result is not built.
  if (!model.featurePreview && (model.parts.length !== expected.length || model.parts.some(part => !expected.some(body => body.id === part.id)))) throw new Error("Rebuild returned unexpected body identities.");
  return {
    ...model, sketchFrames: model.sketchFrames ?? {}, bodyOutputs: model.bodyOutputs ?? {}, scopeResolutions: model.scopeResolutions ?? {},
    sourceName: document.name, parseMilliseconds: performance.now() - started,
    parts: model.parts.map(part => ({ ...part, name: expected.find(body => body.id === part.id)?.name ?? part.name, sourceDocumentId: document.documentId, sourceName: document.name })),
  };
}

/** Measure's exact minimum distance, in the shape the analysis service answers with. */
export async function measureOnAether(document: PartDocument, entities: readonly MeasureEntity[]) {
  try {
    const measurement = await aetherKernel().measureDistance(document, [...entities]);
    return { status: "ok" as const, measurements: [measurement] };
  } catch (error) { rethrow(error, document); }
}

/** Section, interference and physical properties on the engine, in the shape the analysis service answered with. */
export async function analyzeOnAether(document: PartDocument, options: AnalysisOptions) {
  try {
    const result = await aetherKernel().analyzePart(document, options);
    return { status: "ok" as const, kind: result.kind, measurements: result.measurements, parts: result.bodies.map((part) => ({ ...part, sourceDocumentId: document.documentId, sourceName: document.name })) };
  } catch (error) { rethrow(error, document); }
}

/** STEP or STL bytes of the evaluated document. */
export async function exportOnAether(document: PartDocument, options: ExportOptions) {
  try { return await aetherKernel().exportPart(document, options); }
  catch (error) { rethrow(error, document); }
}
