import { validateSketchDrawing, type SketchDrawing } from "../drawing";
import { solveDrawingConstraints } from "../solver/solve";

/** Toggle Radius ↔ Diameter or Point-Line Distance ↔ Linear Diameter (2× across centerline),
 *  preserving numeric value parity or wrapping expressions `(expr) * 2` / `(expr) / 2`. */
export function toggleRadiusDiameter(source: SketchDrawing, constraintId: string): SketchDrawing {
  const next = structuredClone(source);
  const c = next.constraints?.find((item) => item.id === constraintId);
  if (!c) throw new Error("Select an existing radius, diameter, or point-line distance dimension.");
  if (c.kind === "radius" || c.kind === "diameter") {
    const toDiameter = c.kind === "radius";
    c.kind = toDiameter ? "diameter" : "radius";
    if (!c.reference && c.value !== undefined) {
      c.value = toDiameter ? c.value * 2 : c.value / 2;
    }
    if (!c.reference && c.valueExpression !== undefined) {
      c.valueExpression = toDiameter ? `(${c.valueExpression}) * 2` : `(${c.valueExpression}) / 2`;
    }
  } else if (
    (c.kind === "distance" && ((c.a.kind === "point" && c.b?.kind === "line") || (c.a.kind === "line" && c.b?.kind === "point"))) ||
    c.kind === "linear-diameter"
  ) {
    const toDiameter = c.kind === "distance";
    c.kind = toDiameter ? "linear-diameter" : "distance";
    if (toDiameter) delete c.distanceSide;
    if (!c.reference && c.value !== undefined) {
      c.value = toDiameter ? c.value * 2 : c.value / 2;
    }
    if (!c.reference && c.valueExpression !== undefined) {
      c.valueExpression = toDiameter ? `(${c.valueExpression}) * 2` : `(${c.valueExpression}) / 2`;
    }
  } else {
    throw new Error("Only radius, diameter, linear-diameter, and point-to-line distance dimensions can toggle radius/diameter.");
  }
  const solved = solveDrawingConstraints(next);
  validateSketchDrawing(solved);
  return solved;
}
