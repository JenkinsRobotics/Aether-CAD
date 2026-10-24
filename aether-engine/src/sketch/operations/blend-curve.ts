import { contourClosed, validateSketchDrawing, type SketchDrawing, type SketchPoint } from "../drawing";
import type { SketchEntityRef } from "../solver/types";
import { curveJet } from "../curves/derivatives";
import { solveDrawingConstraints } from "../solver/solve";

/** A free end of an open path: which segment, and which of its ends. */
function freeEnd(drawing: SketchDrawing, ref: SketchEntityRef) {
  const path = drawing.contours[ref.contour];
  if (!path || path.type !== "path" || ref.kind !== "point" || ref.index === undefined || !path.segments.length || contourClosed(path) || (ref.index !== 0 && ref.index !== path.segments.length))
    throw new Error("Pick the free end of an open curve for each side of the blend.");
  const segment = ref.index === 0 ? 0 : path.segments.length - 1, endpoint: 0 | 1 = ref.index === 0 ? 0 : 1;
  const start = segment === 0 ? path.start : path.segments[segment - 1].end;
  const jet = curveJet({ start, segment: path.segments[segment] })(endpoint);
  const length = Math.hypot(jet.first[0], jet.first[1]);
  if (length < 1e-12) throw new Error("That curve end has no direction to blend from.");
  const sign = endpoint === 1 ? 1 : -1;
  return { contour: ref.contour, segment, endpoint, point: jet.point, outward: [sign * jet.first[0] / length, sign * jet.first[1] / length] as SketchPoint };
}

/** Blend curve (SolidCraft's sketch.blend_curve): a cubic Bézier from one free curve end to
 *  another, leaving each end along the curve's direction. G1 is tangent at both ends; G2 also
 *  matches curvature, solved with the two source curves held fixed. */
export function blendCurve(drawing: SketchDrawing, a: SketchEntityRef, b: SketchEntityRef, continuity: "g1" | "g2" = "g1", construction = false): SketchDrawing {
  const first = freeEnd(drawing, a), second = freeEnd(drawing, b);
  if (first.contour === second.contour && first.endpoint === second.endpoint) throw new Error("Pick two different curve ends.");
  const [p0, p3] = [first.point, second.point], span = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  if (span < 1e-9) throw new Error("The two ends already meet.");
  const reach = span / 3;
  const next = structuredClone(drawing);
  next.contours.push({ type: "path", start: [...p0], segments: [{ type: "bezier", controls: [[p0[0] + first.outward[0] * reach, p0[1] + first.outward[1] * reach], [p3[0] + second.outward[0] * reach, p3[1] + second.outward[1] * reach]], end: [...p3] }], ...(construction ? { construction: true } : {}) });
  const blend = next.contours.length - 1;
  const constraints = (next.constraints ??= []);
  const ids = new Set(constraints.map((c) => c.id));
  let sequence = 1;
  const id = () => { while (ids.has(`blend-${sequence}`)) sequence++; const value = `blend-${sequence++}`; ids.add(value); return value; };
  const point = (contour: number, index: number): SketchEntityRef => ({ contour, kind: "point", index });
  const curve = (contour: number, index: number, parameter: number): SketchEntityRef => ({ contour, kind: "curve", index, parameter });
  const kind = continuity === "g2" ? "curvature" : "tangent";
  constraints.push(
    { id: id(), kind: "coincident", a: { ...a }, b: point(blend, 0) },
    { id: id(), kind: "coincident", a: { ...b }, b: point(blend, 1) },
    { id: id(), kind, a: curve(first.contour, first.segment, first.endpoint), b: curve(blend, 0, 0) },
    { id: id(), kind, a: curve(blend, 0, 1), b: curve(second.contour, second.segment, second.endpoint) },
  );
  // G1 holds as placed; G2 needs the controls moved, with everything else held where it is.
  let solved = next;
  if (continuity === "g2") {
    try { solved = solveDrawingConstraints(next, { fixedContours: new Set(next.contours.map((_, i) => i).filter((i) => i !== blend)) }); }
    catch { throw new Error("No curvature-matched blend fits these two ends. Use the tangent blend, or move an end."); }
  }
  validateSketchDrawing(solved);
  return solved;
}
