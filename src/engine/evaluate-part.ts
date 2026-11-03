/** One entry for every Part build (UI, agents and thumbnails alike): the Aether
 *  engine, in the worker (or in-process under Node). A feature the engine does
 *  not support is the user's error against that feature, never a silent fallback. */
import type { ImportedModelData } from "@aether/core/contracts";
import type { PartDocument } from "@aether/core/document";
import { FeatureBuildError } from "../modeling/feature-errors";
import { evaluateAetherPart } from "./aether/evaluator";
import { EngineUnsupported } from "./unsupported";

interface EngineRuns<T> { aether: () => Promise<T> }

/** The engine policy for any operation on a document. Builds, measurements and
 *  exports all go through here, so an unsupported feature reads the same everywhere. */
export async function onEngine<T>(runs: EngineRuns<T>): Promise<T> {
  try { return await runs.aether(); }
  catch (error) {
    if (error instanceof EngineUnsupported) throw new FeatureBuildError(new Map([[error.featureId, `The ${error.engine} engine does not support ${error.message} yet.`]]), `${error.engine} does not support ${error.message} yet.`);
    throw error;
  }
}

export function evaluatePart(document: PartDocument, options: { preview?: boolean } = {}): Promise<ImportedModelData> {
  return onEngine({ aether: () => evaluateAetherPart(document, options) });
}
