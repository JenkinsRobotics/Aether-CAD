/** The engine in the calling thread: the worker client's interface, for Node
 *  (tests, the headless runner) where there is no Worker. Loads the kernel from
 *  the package's own wasm; the full build is loaded on demand like the worker does. */
import { readFileSync } from "node:fs";
import { importSTEP } from "replicad";
import type { AnalysisOptions, AnalysisResult, DistanceMeasurement, ExportOptions, ExportResult, ImportedModelData, MeasureEntity } from "../contracts/index";
import type { PartDocument } from "../document/index";
import { evaluatePartDocument, FeatureFailure, UnsupportedFeature } from "./part-evaluator";
import { sketchSectionContours } from "./sketch-section";
import { measureDistance } from "./measure";
import { analyzePart } from "./analysis";
import { checkContacts, type ContactCheckInput, type ContactOverlap } from "./contacts";
import { exportPart } from "./export";
import { buildPartGeometry } from "./part-geometry";
import { initNodeKernel, runNodeOperation } from "./node-kernel";
import { EngineError } from "./worker-client";

const rethrow = (error: unknown): never => {
  if (error instanceof UnsupportedFeature) throw new EngineError(error.message, error.featureId, undefined, true);
  if (error instanceof FeatureFailure) throw new EngineError(error.message, error.featureId, error.featureName);
  throw error;
};

export class InProcessKernelClient {
  readonly ready: Promise<void>;
  constructor(wasmPath = new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) {
    this.ready = initNodeKernel(readFileSync(wasmPath));
  }
  private async run<T>(document: PartDocument | readonly PartDocument[], operation: () => T | Promise<T>): Promise<T> {
    await this.ready;
    try { return await runNodeOperation(document, operation); }
    catch (error) { return rethrow(error); }
  }
  async evaluatePart(document: PartDocument, options: { preview?: boolean } = {}): Promise<ImportedModelData> {
    return this.run(document, () => evaluatePartDocument(document, options));
  }
  async measureDistance(document: PartDocument, entities: MeasureEntity[]): Promise<DistanceMeasurement> {
    return this.run(document, () => measureDistance(document, entities));
  }
  async checkContacts(input: ContactCheckInput): Promise<{ overlaps: ContactOverlap[]; checked_pairs: number }> {
    return this.run(input.parts.map(part => part.document), () => checkContacts(input));
  }

  async analyzePart(document: PartDocument, options: AnalysisOptions): Promise<AnalysisResult> {
    return this.run(document, () => analyzePart(document, options));
  }
  async sketchSection(document: PartDocument, frame: import("../sketch/drawing").SketchFrame, kind: "section" | "edges" | "fit" | "spun", axis?: [[number, number], [number, number]]): Promise<import("../sketch/drawing").SketchContour[]> {
    return this.run(document, () => sketchSectionContours(document, frame, kind, axis));
  }
  async exportPart(document: PartDocument, options: ExportOptions): Promise<ExportResult> {
    return this.run(document, () => exportPart(document, options));
  }
  async importSTEP(file: File): Promise<ImportedModelData> {
    await this.ready;
    const started = performance.now();
    const imported = await importSTEP(new Blob([await file.arrayBuffer()]));
    const sourceDocumentId = crypto.randomUUID();
    try { return { sourceName: file.name, parts: [buildPartGeometry(imported, sourceDocumentId, file.name, 0)], parseMilliseconds: performance.now() - started }; }
    finally { imported.delete(); }
  }
  dispose(): void { /* nothing to terminate */ }
}
