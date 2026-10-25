import { isShape3D, type Shape3D } from "replicad";
import type { PartFeature } from "../../document/index";
type BooleanFeature = Extract<PartFeature, {
  type: "boolean";
}>;
/** Applies this step to the evaluator's candidate body map. Geometry is retained
 * by own(); the evaluator commits or releases the entire step atomically. */
export function applyBooleanFeature(feature: BooleanFeature, bodies: Map<string, Shape3D>, own: <T>(value: T) => T): string {
  // FreeCAD's rule: tools are resolved at this point of the history and,
  // unless kept, consumed by the operation.
  const target = bodies.get(feature.targetBodyId);
  if (!target)
    throw new Error("Boolean needs an existing target solid.");
  if (!feature.toolBodyIds.length)
    throw new Error("Boolean needs at least one tool body.");
  if (new Set(feature.toolBodyIds).size !== feature.toolBodyIds.length)
    throw new Error("Boolean tool bodies must be distinct.");
  const toolShapes = feature.toolBodyIds.map((id) => bodies.get(id));
  if (toolShapes.some((shape) => !shape || shape === target))
    throw new Error("Choose available tool bodies different from the target.");
  let result: Shape3D = target;
  for (const shape of toolShapes as Shape3D[]) {
    const next = feature.operation === "union" ? result.fuse(shape) : feature.operation === "cut" ? result.cut(shape) : result.intersect(shape);
    if (!isShape3D(next))
      throw new Error("The operation left no solid.");
    result = own(next);
  }
  bodies.set(feature.targetBodyId, result);
  if (!feature.keepTools)
    for (const id of feature.toolBodyIds)
      bodies.delete(id);
  return feature.targetBodyId;
}
