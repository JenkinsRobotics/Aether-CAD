import type { ImportedModelData } from "./domain";
import type { PartDocument } from "./part-document";
import { aetherKernel } from "./engine/aether/kernel";
import type { AetherCoreClient } from "./aether-core";
import { evaluatePart } from "./engine/evaluate-part";
import { BrowserDisplayStorage, CachedDisplayEvaluator } from './engine/display-cache';

/** The in-app evaluation adapter for normal and explicit rebuilds. */
export class HostAetherCoreClient implements AetherCoreClient {
  private embedded = aetherKernel();
  readonly ready = this.embedded.ready;
  // Vite's immutable chunk URL changes with the transitive engine build. Never
  // reuse disk geometry across releases or an unversioned development build.
  private readonly display = import.meta.env.PROD && typeof indexedDB !== 'undefined'
    ? new CachedDisplayEvaluator('display-v1:' + import.meta.url, new BrowserDisplayStorage(), evaluatePart) : null;

  async importSTEP(file: File): Promise<ImportedModelData> {
    return this.embedded.importSTEP(file);
  }

  evaluatePart(document: PartDocument, options: { preview?: boolean } = {}): Promise<ImportedModelData> {
    return this.display && !options.preview ? this.display.evaluatePart(document) : evaluatePart(document, options);
  }
}

export function createHostAetherCoreClient(): HostAetherCoreClient {
  return new HostAetherCoreClient();
}
