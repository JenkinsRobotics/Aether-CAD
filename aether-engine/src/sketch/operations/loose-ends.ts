import { contourClosed, type SketchDrawing } from "../drawing";
import type { SketchEntityRef } from "../solver/types";

/** Loose Ends (SolidCraft's sketch.loose_ends): the open path endpoints that no other
 *  endpoint touches (within tolerance) and no coincident relation ties. */
export function looseEnds(drawing: SketchDrawing, toleranceMillimeters = 1e-6): { ref: SketchEntityRef; at: [number, number] }[] {
  const ends: { ref: SketchEntityRef; at: [number, number] }[] = [];
  drawing.contours.forEach((contour, index) => {
    if (contour.type !== "path" || contour.construction || contourClosed(contour) || !contour.segments.length) return;
    ends.push({ ref: { contour: index, kind: "point", index: 0 }, at: contour.start });
    ends.push({ ref: { contour: index, kind: "point", index: contour.segments.length }, at: contour.segments[contour.segments.length - 1].end });
  });
  const key = (r: SketchEntityRef) => `${r.contour}:${r.index}`;
  const tied = new Set<string>();
  for (const c of drawing.constraints ?? []) if (c.kind === "coincident" && c.b) { if (c.a.kind === "point") tied.add(key(c.a)); if (c.b.kind === "point") tied.add(key(c.b)); }
  return ends.filter((end, i) => !tied.has(key(end.ref)) && !ends.some((other, j) => j !== i && Math.hypot(end.at[0] - other.at[0], end.at[1] - other.at[1]) <= toleranceMillimeters));
}
