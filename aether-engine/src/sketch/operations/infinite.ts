import { validateSketchDrawing, type SketchDrawing } from "../drawing";
import type { SketchEntityRef } from "../solver/types";

/** SolidCraft's `sketch.infinite`: make the selected single lines infinite construction
 *  lines (or finite again). Other geometry is left alone and reported. */
export function setSketchInfinite(source: SketchDrawing, refs: readonly SketchEntityRef[], value?: boolean): { drawing: SketchDrawing; changed: number; skipped: number } {
  const next = structuredClone(source);
  let changed = 0, skipped = 0;
  for (const contour of new Set(refs.map((r) => r.contour))) {
    const c = next.contours[contour];
    if (!c || c.type !== "path" || c.segments.length !== 1 || c.segments[0].type !== "line") { skipped++; continue; }
    const on = value ?? !c.infinite;
    if (on) { c.infinite = true; c.construction = true; } else delete c.infinite;
    changed++;
  }
  if (!changed) throw new Error("Select single lines to make infinite.");
  validateSketchDrawing(next);
  return { drawing: next, changed, skipped };
}
