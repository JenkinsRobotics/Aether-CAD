import { identifySketchContour, rollbackPosition, type PartDocument } from "@aether/core/document";
import { validateSketchDrawing, type ModelProjectionOptions, type ModelProjectionResult, type SketchContour, type SketchDrawing, type SketchFrame, type SketchPoint } from "@aether/core/sketch";

export type ModelIncludeKind = "project" | "section" | "edges" | "fit" | "spun";
export interface ModelIncludeKernel {
  projectModelGeometry(document: PartDocument, frame: SketchFrame, options?: ModelProjectionOptions): Promise<ModelProjectionResult>;
  sketchSection(document: PartDocument, frame: SketchFrame, kind: Exclude<ModelIncludeKind, "project">, axis?: [SketchPoint, SketchPoint]): Promise<SketchContour[]>;
}

/** No future feature or the sketch's own downstream solid can become an input. */
export function modelBeforeSketch(document: PartDocument, featureId: string): PartDocument {
  const index = document.features.findIndex(feature => feature.id === featureId);
  const end = index < 0 ? rollbackPosition(document) : Math.min(index, rollbackPosition(document));
  return { ...structuredClone(document), features: structuredClone(document.features.slice(0, end)), rollbackIndex: undefined };
}

/** Shared insertion for UI and agent adapters. Incoming contours are copied and
 * get authored identities; approximation/source association is never implied. */
export function appendModelContours(drawing: SketchDrawing, contours: SketchContour[], construction: boolean): SketchDrawing {
  if (!contours.length) throw Error("The selected model has no geometry on this projection.");
  const next = structuredClone(drawing);
  for (const contour of structuredClone(contours)) {
    delete contour.id;
    if (contour.type === "path") {
      delete contour.startVertexId;
      for (const segment of contour.segments) {
        delete segment.id;
        delete segment.endVertexId;
      }
    }
    if (construction) contour.construction = true;
    identifySketchContour(contour, () => crypto.randomUUID());
    next.contours.push(contour);
  }
  validateSketchDrawing(next);
  return next;
}

export interface ModelIncludeSnapshot {
  document: PartDocument;
  featureId: string;
  frame: SketchFrame;
  drawing: SketchDrawing;
  construction: boolean;
  /** Includes variables, plane/support and other staged edits. */
  revision: string;
}

export function createModelIncludeController(options: {
  kernel: () => ModelIncludeKernel;
  read: () => ModelIncludeSnapshot | null;
  commit: (drawing: SketchDrawing) => void;
  message: (text: string) => void;
}) {
  let disposed = false, pending = false;
  return {
    async include(kind: ModelIncludeKind, input: { axis?: [SketchPoint, SketchPoint]; projection?: ModelProjectionOptions; construction?: boolean } = {}) {
      if (disposed || pending) return;
      const snapshot = options.read();
      if (!snapshot) return;
      const drawing = structuredClone(snapshot.drawing);
      const signature = JSON.stringify(snapshot.drawing);
      const frame = structuredClone(snapshot.frame);
      const current = () => {
        const now = disposed ? null : options.read();
        return !!now && now.revision === snapshot.revision && now.drawing === snapshot.drawing &&
          JSON.stringify(now.drawing) === signature && JSON.stringify(now.frame) === JSON.stringify(frame);
      };
      pending = true;
      options.message(kind === "project" ? "Projecting model geometry onto the sketch plane…" : "Collecting model curves in the sketch plane…");
      try {
        const document = modelBeforeSketch(snapshot.document, snapshot.featureId);
        const kernel = options.kernel();
        const result = kind === "project"
          ? await kernel.projectModelGeometry(document, frame, structuredClone(input.projection ?? {}))
          : { contours: await kernel.sketchSection(document, frame, kind, input.axis), approximatedEdges: [], toleranceMillimeters: 0 };
        if (!current()) return;
        if (!result.contours.length) {
          options.message(kind === "edges" ? "No model edges lie in the sketch plane." : "The model has no curves at this sketch plane.");
          return;
        }
        const candidate = appendModelContours(drawing, result.contours, input.construction ?? snapshot.construction);
        options.commit(candidate);
        const approximation = result.approximatedEdges.length
          ? ` ${result.approximatedEdges.length} edges approximated within ${result.toleranceMillimeters} mm.` : "";
        options.message(`${result.contours.length} model curves added as editable copies.${approximation}`);
      } catch (error) {
        if (current()) options.message(error instanceof Error ? error.message : String(error));
      } finally { pending = false; }
    },
    dispose() { disposed = true; },
  };
}
