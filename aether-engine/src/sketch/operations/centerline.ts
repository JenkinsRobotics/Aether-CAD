import { validateSketchDrawing, type SketchDrawing } from "../drawing";

/** Toggle or set the centerline flag on one or more single- or multi-segment line paths.
 *  Enabling centerline automatically marks the path as construction geometry. */
export function setSketchCenterline(
  source: SketchDrawing,
  contourIndices: number[],
  value?: boolean,
): SketchDrawing {
  if (!contourIndices.length) throw new Error("Select at least one line to mark as a centerline.");
  const next = structuredClone(source);
  const targets = [...new Set(contourIndices)].map((i) => {
    const c = next.contours[i];
    if (!c || c.type !== "path" || !c.segments.length || !c.segments.every((s) => s.type === "line"))
      throw new Error("Centerline requires straight line paths.");
    return c;
  });
  const enable = value ?? !targets.every((c) => Boolean(c.centerline));
  for (const c of targets) {
    if (enable) {
      c.construction = true;
      c.centerline = true;
    } else {
      delete c.centerline;
    }
  }
  validateSketchDrawing(next);
  return next;
}
