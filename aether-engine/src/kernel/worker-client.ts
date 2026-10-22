import type {
  AnalysisOptions,
  AnalysisResult,
  DistanceMeasurement,
  ExportOptions,
  ExportResult,
  ImportedModelData,
  MeasureEntity,
  WorkerRequest,
  WorkerResponse,
} from "../contracts/index";
import type { PartDocument } from "../document/index";

interface PendingRequest {
  resolve: (result: never) => void;
  reject: (error: Error) => void;
}

/** A worker failure that names the feature; `unsupported` means another engine may build it. */
export class EngineError extends Error {
  constructor(message: string, readonly featureId?: string, readonly featureName?: string, readonly unsupported = false) { super(message); this.name = "EngineError"; }
}

export class OCCTWorkerClient {
  private readonly worker = new Worker(
    new URL("./occt.worker.ts", import.meta.url),
    { type: "module" },
  );
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private readyResolve: (() => void) | undefined;
  private readyReject: ((error: Error) => void) | undefined;
  readonly ready = new Promise<void>((resolve, reject) => {
    this.readyResolve = resolve;
    this.readyReject = reject;
  });

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.type === "ready") {
        this.readyResolve?.();
        return;
      }
      if (response.type === "error" && response.requestId === undefined) {
        this.readyReject?.(new Error(response.message));
        return;
      }
      if (response.type === "error") {
        const pending = this.pending.get(response.requestId ?? -1);
        if (!pending) return;
        this.pending.delete(response.requestId ?? -1);
        pending.reject(new EngineError(response.message, response.featureId, response.featureName, response.unsupported));
        return;
      }
      const pending = this.pending.get(response.requestId);
      if (!pending) return;
      this.pending.delete(response.requestId);
      pending.resolve((response.type === "distance-measured" ? response.measurement : response.type === "sketch-sectioned" ? response.contours : "result" in response ? response.result : response.model) as never);
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "OCCT worker failed");
      this.readyReject?.(error);
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    };
  }

  async importSTEP(file: File): Promise<ImportedModelData> {
    await this.ready;
    const requestId = this.nextRequestId++;
    const bytes = await file.arrayBuffer();
    const promise = new Promise<ImportedModelData>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
    });
    const request: WorkerRequest = {
      type: "import-step",
      requestId,
      sourceName: file.name,
      bytes,
    };
    this.worker.postMessage(request, [bytes]);
    return promise;
  }

  private send<T>(request: WorkerRequest extends infer R ? R extends unknown ? Omit<R, "requestId"> : never : never): Promise<T> {
    const requestId = this.nextRequestId++;
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as (result: never) => void, reject });
    });
    this.worker.postMessage({ ...request, requestId } as WorkerRequest);
    return promise;
  }

  async evaluatePart(document: PartDocument, options: { preview?: boolean } = {}): Promise<ImportedModelData> {
    await this.ready;
    return this.send<ImportedModelData>({ type: "evaluate-part", document, options });
  }

  async measureDistance(document: PartDocument, entities: MeasureEntity[]): Promise<DistanceMeasurement> {
    await this.ready;
    return this.send<DistanceMeasurement>({ type: "measure-distance", document, entities });
  }

  async analyzePart(document: PartDocument, options: AnalysisOptions): Promise<AnalysisResult> {
    await this.ready;
    return this.send<AnalysisResult>({ type: "analyze-part", document, options });
  }

  async sketchSection(document: PartDocument, frame: import("../sketch/drawing").SketchFrame, kind: "section" | "edges"): Promise<import("../sketch/drawing").SketchContour[]> {
    await this.ready;
    return this.send<import("../sketch/drawing").SketchContour[]>({ type: "sketch-section", document, frame, kind });
  }

  async exportPart(document: PartDocument, options: ExportOptions): Promise<ExportResult> {
    await this.ready;
    return this.send<ExportResult>({ type: "export-part", document, options });
  }

  dispose(): void {
    this.worker.terminate();
  }
}

