import type { ImportedModelData } from "./domain";
import type { PartDocument } from "./part-document";
import { OCCTWorkerClient } from "@aether/core/kernel";
import type { AetherCoreClient } from "./aether-core";
import { evaluateNativePart } from "./native-part-evaluator";

/** One FreeCAD request/response adapter for normal and explicit rebuilds. */
export class HostAetherCoreClient implements AetherCoreClient {
  private embedded = new OCCTWorkerClient();
  readonly ready = this.embedded.ready;

  async importSTEP(file: File): Promise<ImportedModelData> {
    return this.embedded.importSTEP(file);
  }

  evaluatePart(document: PartDocument, options: { preview?: boolean } = {}): Promise<ImportedModelData> {
    return evaluateNativePart(document, options);
  }
}

export function createHostAetherCoreClient(): HostAetherCoreClient {
  return new HostAetherCoreClient();
}
