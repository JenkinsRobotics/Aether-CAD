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
import { initNodeKernel } from "./node-kernel";
import { loadExtendedKernel, needsExtendedKernel } from "./extended-kernel";
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
  private async prepare(document: PartDocument, full = false): Promise<void> {
    await this.ready;
    if (full || needsExtendedKernel(document)) await loadExtendedKernel(async () => (await import("opencascade.js/dist/node.js")).default());
  }
  async evaluatePart(document: PartDocument, options: { preview?: boolean } = {}): Promise<ImportedModelData> {
    await this.prepare(document);
    try { return evaluatePartDocument(document, options); }
    catch (error) {
      if (error instanceof UnsupportedFeature && error.fullBuild) { await this.prepare(document, true); try { return evaluatePartDocument(document, options); } catch (again) { return rethrow(again); } }
      return rethrow(error);
    }
  }
  async measureDistance(document: PartDocument, entities: MeasureEntity[]): Promise<DistanceMeasurement> {
    await this.prepare(document);
    try { return measureDistance(document, entities); } catch (error) { return rethrow(error); }
  }
  async checkContacts(input: ContactCheckInput): Promise<{ overlaps: ContactOverlap[]; checked_pairs: number }> {
    for (const part of input.parts) await this.prepare(part.document);
    return checkContacts(input);
  }

  async analyzePart(document: PartDocument, options: AnalysisOptions): Promise<AnalysisResult> {
    await this.prepare(document);
    try { return analyzePart(document, options); } catch (error) { return rethrow(error); }
  }
  async sketchSection(document: PartDocument, frame: import("../sketch/drawing").SketchFrame, kind: "section" | "edges"): Promise<import("../sketch/drawing").SketchContour[]> {
    await this.prepare(document);
    try { return sketchSectionContours(document, frame, kind); } catch (error) { return rethrow(error); }
  }
  async exportPart(document: PartDocument, options: ExportOptions): Promise<ExportResult> {
    await this.prepare(document);
    try { return await exportPart(document, options); } catch (error) { return rethrow(error); }
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
