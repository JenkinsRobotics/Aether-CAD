import initOpenCascade from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/src/replicad_single.wasm?url";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import { importSTEP, setOC } from "replicad";
import type {
  ImportedModelData,
  WorkerRequest,
  WorkerResponse,
} from "../contracts/index";
import { evaluatePartDocument, FeatureFailure, UnsupportedFeature } from "./part-evaluator";
import { sketchSectionContours } from "./sketch-section";
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

/** The first builds after loading run on the wasm baseline compiler and cold
 *  JS; a few small previews in idle slices tier the hot paths up before the
 *  user's first edit (in Node a plate preview is 3 ms warm, in the browser the
 *  first was 12–17 ms). One slice per turn, so a real request never waits. */
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
    if (round >= rounds) return;
    try { evaluatePartDocument(document(4 + (round % 5), round), { preview: round % 4 !== 3 }); } catch { /* warm-up only */ }
    round++;
    setTimeout(step, 0);
  };
  setTimeout(step, 0);
}

/** The full OpenCascade.js build (50 MB), fetched the first time a document needs it. */
async function prepareFor(document: { features: unknown[] }): Promise<void> {
  await ensureInitialized();
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

