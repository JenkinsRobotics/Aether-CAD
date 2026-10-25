import type { Shape3D } from "replicad";
import type { PartDocument } from "../../document/part-document";
import { validateSketchDrawing, type SketchContour, type SketchFrame } from "../../sketch/drawing";
import { validateModelProjection, type ModelProjectionOptions, type ModelProjectionResult } from "../../sketch/model-projection";
import { evaluatePartDocument } from "../part-evaluator";
import { projectModelEdge } from "./edge";
import { withProjectionSources } from "./sources";
import { projectionFrame } from "./frame";
import { deduplicateProjection } from "./deduplicate";

/** Orthogonal boundary projection, with no hidden-line removal or silhouette
 * generation. Returned contours are copies, not persistent source links. */
export function projectModelGeometry(document: PartDocument, frame: SketchFrame, options: ModelProjectionOptions = {}): ModelProjectionResult {
  validateModelProjection(frame, options);
  let result: ModelProjectionResult | undefined;
  evaluatePartDocument(document, { withBodies: bodies => {
    result = projectBodyGeometry(bodies, frame, options);
  } });
  if (!result) throw Error("Create an exact model before projecting its geometry.");
  return result;
}

/** Borrow evaluated bodies. All wrappers created by selection/conversion are
 * scoped to this operation; a failed selection or conversion returns no output. */
export function projectBodyGeometry(bodies: ReadonlyMap<string, Shape3D>, frame: SketchFrame, options: ModelProjectionOptions = {}): ModelProjectionResult {
  const toleranceMillimeters = validateModelProjection(frame, options);
  const map = projectionFrame(frame);
  return withProjectionSources(bodies, options.entities, sources => {
    const contours: SketchContour[] = [], approximatedEdges: ModelProjectionResult["approximatedEdges"] = [];
    for (const { entity, edge } of sources) {
      if (entity.vertex !== undefined) {
        const vertex = entity.vertex === "a" ? edge.startPoint : edge.endPoint;
        try { contours.push({ type: "path", start: map.point([vertex.x, vertex.y, vertex.z]), segments: [] }); }
        finally { vertex.delete(); }
      } else {
        const projected = projectModelEdge(edge, frame, toleranceMillimeters);
        contours.push(projected.contour);
        if (projected.approximated) approximatedEdges.push({ ...entity });
      }
    }
    const unique = deduplicateProjection(contours);
    validateSketchDrawing({ type: "drawing", contours: unique });
    return { contours: unique, approximatedEdges, toleranceMillimeters };
  });
}
