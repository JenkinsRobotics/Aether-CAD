import {resolveExtrusionScopes} from './extrusion-scope-resolution';
import { featureReferenceErrors, type PartDocument } from '@aether/core/document';
import type { ImportedModelData } from '../domain';
import { resolveSketchFrames } from './sketch-support';
import { resolveBodyOutputs } from './body-outputs';

export class FeatureBuildError extends Error {
  constructor(readonly failures: ReadonlyMap<string, string>, message: string) { super(message); }
}

// A projection of the latest build; never serialized into feature definitions.
let evaluated: { document: PartDocument; failures: ReadonlyMap<string, string> } | null = null;
export function recordFeatureErrors(document: PartDocument, failures: ReadonlyMap<string, string>) { evaluated = { document, failures }; }
export function errorsForDocument(document: PartDocument) {
  return featureReferenceErrors(document, evaluated?.document.documentId === document.documentId && evaluated.document.features === document.features ? evaluated.failures : undefined);
}
export function renderableDocument(document: PartDocument | null): PartDocument | null {
  if (!document) return null;
  const errors = errorsForDocument(document);
  return errors.size ? { ...document, features: document.features.map(f => errors.has(f.id) ? { ...f, suppressed: true } : f) } : document;
}

/** Retry from a clean native document after excluding a failed branch. Never use
 * geometry from a failed native build (a partially applied feature may corrupt it). */
export async function rebuildRecovering(document: PartDocument, evaluate: (doc: PartDocument) => Promise<ImportedModelData>) {
  let failures = featureReferenceErrors(document);
  for (let attempt = 0; attempt <= document.features.length; attempt++) {
    const candidate = { ...document, features: document.features.map(f => failures.has(f.id) ? { ...f, suppressed: true } : f) };
    try {
      const model = await evaluate(candidate);
      const resolved = resolveExtrusionScopes(resolveBodyOutputs(resolveSketchFrames(candidate, model.sketchFrames), model.bodyOutputs),model.scopeResolutions);
      return { model, failures, document: { ...document, features: resolved.features.map((f, i) => ({ ...f, suppressed: document.features[i].suppressed })) } };
    }
    catch (error) {
      if (!(error instanceof FeatureBuildError)) throw error;
      const before = failures.size;
      failures = featureReferenceErrors(document, new Map([...failures, ...error.failures]));
      if (failures.size <= before) throw error;
    }
  }
  throw new Error('Unable to isolate failed features.');
}
