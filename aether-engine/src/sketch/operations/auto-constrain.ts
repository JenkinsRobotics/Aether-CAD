import { contourClosed, type SketchDrawing } from "../drawing";
import type { DrawingConstraint, SketchEntityRef } from "../solver/types";

/** AutoConstrain (SolidCraft's sketch.auto_constrain): lines within the angle
 *  tolerance of the axes become horizontal or vertical, and path endpoints that
 *  nearly meet become coincident, unless an equivalent relation already exists.
 *  Nothing moves here; the solver places the geometry on the next solve. */
export function autoConstrainDrawing(source: SketchDrawing, options: { angleToleranceDegrees?: number; distanceToleranceMillimeters?: number } = {}): { drawing: SketchDrawing; added: number } {
  const angle = options.angleToleranceDegrees ?? 2, distance = options.distanceToleranceMillimeters ?? 0.05;
  const next = structuredClone(source);
  const constraints = (next.constraints ??= []);
  const ids = new Set(constraints.map((c) => c.id));
  let sequence = 1, added = 0;
  const key = (r: SketchEntityRef) => `${r.contour}:${r.kind}:${r.index ?? ""}:${r.vertexId ?? ""}`;
  const has = (kind: DrawingConstraint["kind"], a: SketchEntityRef, b?: SketchEntityRef) => constraints.some((c) => c.kind === kind && ((key(c.a) === key(a) && (!b || (c.b && key(c.b) === key(b)))) || (b && c.b && key(c.a) === key(b) && key(c.b) === key(a))));
  const add = (constraint: Omit<DrawingConstraint, "id">) => { while (ids.has(`auto-${sequence}`)) sequence++; const id = `auto-${sequence++}`; ids.add(id); constraints.push({ ...constraint, id }); added++; };
  const ends: { ref: SketchEntityRef; at: [number, number] }[] = [];
  next.contours.forEach((contour, index) => {
    if (contour.type !== "path") return;
    let from = contour.start;
    contour.segments.forEach((segment, i) => {
      if (segment.type === "line") {
        const dx = segment.end[0] - from[0], dy = segment.end[1] - from[1], length = Math.hypot(dx, dy);
        if (length > 1e-9) {
          const tilt = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
          const ref: SketchEntityRef = { contour: index, kind: "line", index: i };
          if ((tilt < angle || Math.abs(tilt - 180) < angle) && !has("horizontal", ref) && !has("vertical", ref)) add({ kind: "horizontal", a: ref });
          else if (Math.abs(tilt - 90) < angle && !has("horizontal", ref) && !has("vertical", ref)) add({ kind: "vertical", a: ref });
        }
      }
      from = segment.end;
    });
    if (!contourClosed(contour) && contour.segments.length) {
      ends.push({ ref: { contour: index, kind: "point", index: 0 }, at: contour.start });
      ends.push({ ref: { contour: index, kind: "point", index: contour.segments.length }, at: contour.segments[contour.segments.length - 1].end });
    }
  });
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
    if (ends[i].ref.contour === ends[j].ref.contour) continue;
    if (Math.hypot(ends[i].at[0] - ends[j].at[0], ends[i].at[1] - ends[j].at[1]) <= distance && !has("coincident", ends[i].ref, ends[j].ref)) add({ kind: "coincident", a: ends[i].ref, b: ends[j].ref });
  }
  return { drawing: next, added };
}
