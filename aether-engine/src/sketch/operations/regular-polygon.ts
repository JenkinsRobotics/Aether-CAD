import { contourClosed, validateSketchDrawing, type SketchDrawing, type SketchPoint } from "../drawing";
import type { DrawingConstraint, SketchEntityRef } from "../solver/types";

/** SolidCraft's polygon constraint: the lines of one closed chain become a regular
 *  polygon — equal sides, every corner on one construction circle. The circle is
 *  added through the first three corners; the solver places the rest. */
export function constrainRegularPolygon(source: SketchDrawing, refs: readonly SketchEntityRef[]): { drawing: SketchDrawing; sides: number } {
  const contours = new Set(refs.map((r) => r.contour));
  if (contours.size !== 1) throw new Error("Select the lines of one closed chain.");
  const [index] = contours;
  const contour = source.contours[index];
  if (!contour || contour.type !== "path" || !contourClosed(contour) || contour.segments.length < 3 || contour.segments.some((s) => s.type !== "line"))
    throw new Error("A polygon constraint needs a closed chain of three or more lines.");
  const corners: SketchPoint[] = [contour.start, ...contour.segments.slice(0, -1).map((s) => s.end)];
  const [a, b, c] = corners;
  const dx = b[0] - a[0], dy = b[1] - a[1], ux = c[0] - a[0], uy = c[1] - a[1], det = 2 * (dx * uy - dy * ux);
  if (Math.abs(det) < 1e-10) throw new Error("The first three corners must not be collinear.");
  const q = dx * dx + dy * dy, r2 = ux * ux + uy * uy;
  const center: SketchPoint = [a[0] + (q * uy - r2 * dy) / det, a[1] + (dx * r2 - ux * q) / det];
  const next = structuredClone(source);
  const circle = next.contours.length;
  next.contours.push({ type: "circle", center, radius: Math.hypot(center[0] - a[0], center[1] - a[1]), construction: true });
  const constraints = (next.constraints ??= []);
  const ids = new Set(constraints.map((k) => k.id));
  let sequence = 1;
  const add = (constraint: Omit<DrawingConstraint, "id">) => { while (ids.has(`polygon-${sequence}`)) sequence++; const id = `polygon-${sequence++}`; ids.add(id); constraints.push({ ...constraint, id } as DrawingConstraint); };
  const n = contour.segments.length;
  for (let i = 0; i < n; i++) add({ kind: "coincident", a: { contour: index, kind: "point", index: i }, b: { contour: circle, kind: "circle" } });
  for (let i = 1; i < n; i++) add({ kind: "equal", a: { contour: index, kind: "line", index: i - 1 }, b: { contour: index, kind: "line", index: i } });
  validateSketchDrawing(next);
  return { drawing: next, sides: n };
}
