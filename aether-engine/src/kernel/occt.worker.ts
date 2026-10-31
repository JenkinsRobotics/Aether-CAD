import initOpenCascade from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/src/replicad_single.wasm?url";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import { importSTEP, setOC } from "replicad";
import type {
  ImportedModelData,
  WorkerRequest,
  WorkerResponse,
} from "../contracts/index";
import { cachedSteps, evaluatePartDocument, FeatureFailure, restoreEvaluation, snapshotEvaluation, UnsupportedFeature } from "./part-evaluator";
import { ReplayStore } from "./replay-store";
import { sketchSectionContours } from "./sketch-section";
import { projectModelGeometry } from "./sketch-projection";
import { measureDistance } from "./measure";
import { analyzePart } from "./analysis";
import { projectPartDrawing } from "./drawing-projection";
import { checkContacts } from "./contacts";
import { loadExtendedKernel, needsExtendedKernel } from "./extended-kernel";
import ocFullJS from "opencascade.js/dist/opencascade.full.js";
import fullWasmUrl from "opencascade.js/dist/opencascade.full.wasm?url";
import { exportPart } from "./export";
import { buildPartGeometry } from "./part-geometry";
import { PART_DOCUMENT_VERSION, type PartDocument } from "../document/part-document";

let initialized: Promise<void> | undefined;
let foregroundRequested = false;

async function ensureInitialized(): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      const response = await fetch(wasmUrl);
      if (!response.ok) throw new Error(`Could not fetch OCCT WASM (${response.status})`);
      const wasmBinary = await response.arrayBuffer();
      // The generated package declaration omits Emscripten's optional module
      // arguments even though the runtime accepts them. Passing wasmBinary
      // makes worker startup deterministic under Vite instead of relying on
      // Emscripten to reconstruct the emitted asset URL.
      const initialize = initOpenCascade as unknown as (options: {
        wasmBinary: ArrayBuffer;
      }) => Promise<OpenCascadeInstance>;
      const oc = await initialize({ wasmBinary });
      setOC(oc);
      warmUp();
    })();
  }
  await initialized;
}

/** Use spare startup time to tier up WASM, but stop as soon as real work arrives.
 * Timers are not idle callbacks: continuing them between assembly parts delays
 * every foreground rebuild and evicts its history from the kernel cache. */
function warmUp(rounds = 40): void {
  const document = (depth: number, round: number) => ({
    format: "aether-part", formatVersion: PART_DOCUMENT_VERSION, units: "millimeter", documentId: "warm-up", name: "warm-up",
    features: [
      { id: "s", type: "profile", name: "s", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[-20, -12], [20, -12], [20, 12], [-20, 12]] } },
      { id: "e", type: "extrude", name: "e", profileFeatureId: "s", distanceMillimeters: 8 + (depth % 3), endType: "blind", operation: "new", separateBodies: true, suppressed: false },
      { id: "h", type: "profile", name: "h", plane: "XY", offsetMillimeters: 8, suppressed: false, profile: { type: "circle", radiusMillimeters: 3, centerMillimeters: [5, 2] } },
      { id: "c", type: "extrude", name: "c", profileFeatureId: "h", distanceMillimeters: depth, endType: round % 2 ? "through-all" : "blind", operation: "cut", suppressed: false },
    ],
  }) as unknown as PartDocument;
  let round = 0;
  const step = () => {
    if (foregroundRequested || round >= rounds) return;
    try { evaluatePartDocument(document(4 + (round % 5), round), { preview: round % 4 !== 3 }); } catch { /* warm-up only */ }
    round++;
    setTimeout(step, 0);
  };
  setTimeout(step, 0);
}

// Exact replay steps outlive the worker, so the first edit after reopening replays only its tail.
// Production only: Vite's fingerprinted chunk URL changes with every engine build.
const replay = (import.meta as { env?: { PROD?: boolean } }).env?.PROD && typeof indexedDB !== "undefined"
  ? new ReplayStore("replay-v1:" + import.meta.url) : undefined;
const saves = new Map<string, ReturnType<typeof setTimeout>>();

/** Written once the worker has been idle a moment, so a burst of edits serializes once. */
function saveReplay(document: PartDocument): void {
  if (!replay) return;
  clearTimeout(saves.get(document.documentId));
  saves.set(document.documentId, setTimeout(() => {
    saves.delete(document.documentId);
    try { const snapshot = snapshotEvaluation(document); if (snapshot) replay.write(document.documentId, snapshot).catch(() => undefined); }
    catch { /* Disposable: the source document is untouched. */ }
  }, 1500));
}

/** The full OpenCascade.js build (50 MB), fetched the first time a document needs it. */
async function prepareFor(document: { features: unknown[] }): Promise<void> {
  await ensureInitialized();
  const part = document as PartDocument;
  if (replay && typeof part.documentId === "string" && !cachedSteps(part.documentId)) {
    const snapshot = await replay.read(part.documentId).catch(() => undefined);
    if (snapshot) restoreEvaluation(part, snapshot);
  }
  if (!needsExtendedKernel(document as never)) return;
  await loadExtendedKernel(() => new (ocFullJS as unknown as new (options: object) => Promise<unknown>)({ locateFile: (path: string) => (path.endsWith(".wasm") ? fullWasmUrl : path) }));
}

async function importModel(
  sourceName: string,
  bytes: ArrayBuffer,
): Promise<ImportedModelData> {
  await ensureInitialized();
  const started = performance.now();
  const imported = await importSTEP(new Blob([bytes]));
  const sourceDocumentId = crypto.randomUUID();
  try {
    return {
      sourceName,
      // One imported STEP document is one independently movable Part. The
      // complete shape keeps assembly sub-solids in their source coordinates
      // and, unlike Replicad's per-solid browser wrappers, reliably exposes
      // analytic faces on curved CAD. Import separate STEP files when the
      // operator needs separately movable Parts.
      parts: [buildPartGeometry(imported, sourceDocumentId, sourceName, 0)],
      parseMilliseconds: performance.now() - started,
    };
  } finally {
    imported.delete();
  }
}

/** A feature only the full build can do (an offset beside a spline face) loads it on demand, once. */
async function evaluateWithFullBuildFallback(document: PartDocument, options: { preview?: boolean } = {}) {
  try { return evaluatePartDocument(document, options); }
  catch (error) {
    if (!(error instanceof UnsupportedFeature) || !error.fullBuild) throw error;
    await loadExtendedKernel(() => new (ocFullJS as unknown as new (options: object) => Promise<unknown>)({ locateFile: (path: string) => (path.endsWith(".wasm") ? fullWasmUrl : path) }));
    return evaluatePartDocument(document, options);
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  foregroundRequested = true;
  const request = event.data;
  try {
    if (request.type === "project-drawing") {
      await prepareFor(request.document);
      const response: WorkerResponse = { type: "drawing-projected", requestId: request.requestId, result: projectPartDrawing(request.document, request.options) };
      self.postMessage(response);
      return;
    }
    if (request.type === "check-contacts") {
      for (const part of request.input.parts) await prepareFor(part.document);
      const result = checkContacts(request.input);
      const response: WorkerResponse = { type: "contacts-checked", requestId: request.requestId, result };
      self.postMessage(response);
      return;
    }
    if (request.type === "analyze-part") {
      await prepareFor(request.document);
      const result = analyzePart(request.document, request.options);
      const response: WorkerResponse = { type: "part-analyzed", requestId: request.requestId, result };
      self.postMessage(response, { transfer: result.bodies.flatMap((part) => [part.vertices.buffer, part.normals.buffer, part.triangles.buffer, part.edgeLines.buffer]) });
      return;
    }
    if (request.type === "export-part") {
      await prepareFor(request.document);
      const result = await exportPart(request.document, request.options);
      const response: WorkerResponse = { type: "part-exported", requestId: request.requestId, result };
      self.postMessage(response, { transfer: [result.bytes] });
      return;
    }
    if (request.type === "project-model-geometry") {
      await prepareFor(request.document);
      const response: WorkerResponse = { type: "model-projected", requestId: request.requestId, result: projectModelGeometry(request.document, request.frame, request.options) };
      self.postMessage(response);
      return;
    }
    if (request.type === "sketch-section") {
      await prepareFor(request.document);
      const response: WorkerResponse = { type: "sketch-sectioned", requestId: request.requestId, contours: sketchSectionContours(request.document, request.frame, request.kind, request.axis) };
      self.postMessage(response);
      return;
    }
    if (request.type === "measure-distance") {
      await prepareFor(request.document);
      const response: WorkerResponse = { type: "distance-measured", requestId: request.requestId, measurement: measureDistance(request.document, request.entities) };
      self.postMessage(response);
      return;
    }
    const model =
      request.type === "import-step"
        ? await importModel(request.sourceName, request.bytes)
        : (await prepareFor(request.document), await evaluateWithFullBuildFallback(request.document, request.options));
    if (request.type === "evaluate-part" && !request.options?.preview) saveReplay(request.document);
    // Meshes move to the viewer; nothing is copied.
    const transfer: Transferable[] = [];
    const parts = [...model.parts, ...(model.featurePreview ? [...model.featurePreview.base, ...model.featurePreview.added, ...model.featurePreview.removed] : [])];
    for (const part of parts) {
      transfer.push(
        part.vertices.buffer,
        part.normals.buffer,
        part.triangles.buffer,
        part.edgeLines.buffer,
      );
    }
    const response: WorkerResponse = {
      type: request.type === "import-step" ? "imported" : "part-evaluated",
      requestId: request.requestId,
      model,
    };
    self.postMessage(response, { transfer });
  } catch (error) {
    const response: WorkerResponse = {
      type: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof UnsupportedFeature ? { featureId: error.featureId, unsupported: true } : {}),
      ...(error instanceof FeatureFailure ? { featureId: error.featureId, featureName: error.featureName } : {}),
    };
    self.postMessage(response);
  }
};

ensureInitialized()
  .then(() => {
    const response: WorkerResponse = { type: "ready" };
    self.postMessage(response);
  })
  .catch((error) => {
    const response: WorkerResponse = {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  });

