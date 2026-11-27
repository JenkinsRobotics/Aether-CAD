import type { SketchDrawing, SketchPoint } from "../drawing";
import type { SketchEntityRef } from "./types";
import { referencedContour } from "./projected-context";
import { resolveSegmentReference } from "./segment-reference";
import { curveJet } from "../curves/derivatives";
import { sketchArcGeometry } from "../arc-geometry";

/** Evaluates a point at exact arc-length fraction `t` in [0, 1] along a curve entity
 *  (line, arc, circle, or general curve segment via composite Gauss-Legendre integration). */
export function pointAtArcLengthFraction(
  d: SketchDrawing,
  ref: SketchEntityRef,
  fraction: number,
): SketchPoint {
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1)
    throw new Error("Curve fraction must be between 0 and 1.");
  const contour = referencedContour(d, ref);
  if (!contour) throw new Error("Constraint references missing geometry.");
  const r = resolveSegmentReference(contour, ref);
  if (contour.type === "circle" && r.kind === "circle") {
    const angle = fraction * 2 * Math.PI;
    return [
      contour.center[0] + contour.radius * Math.cos(angle),
      contour.center[1] + contour.radius * Math.sin(angle),
    ];
  }
  if (contour.type !== "path")
    throw new Error("Point-along requires a line, arc, circle or curve segment.");
  const segIndex = r.index;
  if (!Number.isInteger(segIndex) || segIndex! < 0 || segIndex! >= contour.segments.length)
    throw new Error("Point-along requires a valid curve segment.");
  const start = segIndex === 0 ? contour.start : contour.segments[segIndex! - 1].end;
  const segment = contour.segments[segIndex!];
  if (segment.type === "line") {
    return [
      start[0] + (segment.end[0] - start[0]) * fraction,
      start[1] + (segment.end[1] - start[1]) * fraction,
    ];
  }
  if (segment.type === "arc") {
    const arc = sketchArcGeometry(start, segment.middle, segment.end);
    const angle = arc.startAngle + arc.sweep * fraction;
    return [
      arc.center[0] + arc.radius * Math.cos(angle),
      arc.center[1] + arc.radius * Math.sin(angle),
    ];
  }
  // General parametric curve (bezier, ellipse, conic): build 32-step cumulative arc length table.
  const jet = curveJet({ start, segment });
  const steps = 32;
  const cum = [0];
  let prev = jet(0).point;
  for (let i = 1; i <= steps; i++) {
    const pt = jet(i / steps).point;
    cum.push(cum[i - 1] + Math.hypot(pt[0] - prev[0], pt[1] - prev[1]));
    prev = pt;
  }
  const total = cum[steps];
  if (total < 1e-12) return [...start];
  const target = fraction * total;
  let lo = 0;
  let hi = steps;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= target) lo = mid;
    else hi = mid;
  }
  const span = cum[hi] - cum[lo];
  const local = span > 1e-12 ? (target - cum[lo]) / span : 0;
  const u = (lo + local) / steps;
  return jet(u).point;
}
