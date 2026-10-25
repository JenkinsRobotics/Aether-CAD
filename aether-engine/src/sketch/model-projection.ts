import type { MeasureEntity } from "../contracts/geometry";
import type { SketchContour, SketchFrame } from "./drawing";
import { sketchFrameMap } from "./projection/frame-map";

/** Transient evaluated topology selections, never persisted as associative IDs.
 * Omitted entities selects all exact body boundaries, not a silhouette. */
export interface ModelProjectionOptions {
  entities?: MeasureEntity[];
  toleranceMillimeters?: number;
}

export interface ModelProjectionResult {
  contours: SketchContour[];
  /** Only nonanalytic/noncubic edges require a polyline approximation. */
  approximatedEdges: MeasureEntity[];
  toleranceMillimeters: number;
}

export function validateModelProjection(
  frame: SketchFrame,
  options: ModelProjectionOptions,
): number {
  sketchFrameMap(frame, frame);
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw Error("Model projection options must be an object.");
  if (Object.keys(options).some(k => !["entities", "toleranceMillimeters"].includes(k)))
    throw Error("Unknown model projection option.");
  const tolerance = options.toleranceMillimeters === undefined ? 0.01 : options.toleranceMillimeters;
  if (!Number.isFinite(tolerance) || tolerance < 0.00001 || tolerance > 1)
    throw Error("Projection tolerance must be between 0.00001 and 1 millimeter.");
  if (options.entities !== undefined) {
    if (!Array.isArray(options.entities) || !options.entities.length || options.entities.length > 256)
      throw Error("Choose between 1 and 256 model entities.");
    for (const entity of options.entities) {
      if (!entity || typeof entity !== "object" || Array.isArray(entity) ||
          Object.keys(entity).some(k => !["body_id", "face_id", "edge_index", "vertex"].includes(k)))
        throw Error("Invalid model projection entity.");
      if (typeof entity.body_id !== "string" || !entity.body_id.trim() || entity.body_id.length > 256)
        throw Error("Choose an existing model body_id.");
      if (entity.face_id !== undefined && !Number.isSafeInteger(entity.face_id))
        throw Error("A projection face identifier must be an integer.");
      if (entity.edge_index !== undefined && (!Number.isSafeInteger(entity.edge_index) || entity.edge_index < 0))
        throw Error("A projection edge index must be a nonnegative integer.");
      if (entity.edge_index !== undefined && entity.face_id === undefined)
        throw Error("A projected edge requires its face_id.");
      if (entity.vertex !== undefined &&
          (!["a", "b"].includes(entity.vertex) || entity.edge_index === undefined))
        throw Error("A projected vertex requires an edge and endpoint a or b.");
    }
  }
  return tolerance;
}
