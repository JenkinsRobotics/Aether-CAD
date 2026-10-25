import type { SketchContour, SketchPoint, SketchSegment } from "../../sketch/drawing";
import { ellipseFrame, segmentPoint } from "../../sketch/curves/parameterization";

// Used only to compare output geometry, never to round authored coordinates.
const key = (value: unknown) => JSON.stringify(value, (_k, v) => typeof v === "number" ? Math.round(v * 1e7) / 1e7 : v);
const ordered = (a: unknown[], b: unknown[]) => [key(a), key(b)].sort()[0];

function ellipseShape(start: SketchPoint, segment: Extract<SketchSegment, { type: "ellipse" }>) {
  const f = ellipseFrame(start, segment), c = Math.cos(f.rotation), s = Math.sin(f.rotation);
  const a = f.radiusX ** 2, b = f.radiusY ** 2;
  return [f.center, a * c * c + b * s * s, (a - b) * c * s, a * s * s + b * c * c];
}

function segmentKey(start: SketchPoint, s: SketchSegment): string {
  switch (s.type) {
    case "line": return ordered([s.type, start, s.end], [s.type, s.end, start]);
    case "arc": return ordered([s.type, start, s.middle, s.end], [s.type, s.end, s.middle, start]);
    case "bezier": return ordered([s.type, start, ...s.controls, s.end], [s.type, s.end, ...[...s.controls].reverse(), start]);
    case "conic": return ordered([s.type, start, s.control, s.rho, s.end], [s.type, s.end, s.control, s.rho, start]);
    case "ellipse": {
      const shape = ellipseShape(start, s), middle = segmentPoint(start, s, 0.5);
      return ordered([s.type, shape, start, middle, s.end], [s.type, shape, s.end, middle, start]);
    }
  }
}

/** Different model edges can project to the same curve (box top/bottom edges,
 * cylinder end rings). Do not create overlapping duplicate sketch geometry. */
export function deduplicateProjection(contours: SketchContour[]): SketchContour[] {
  const seen = new Set<string>();
  return contours.filter(contour => {
    let signature: string;
    if (contour.type === "circle") signature = key(["circle", contour.center, contour.radius]);
    else if (!contour.segments.length) signature = key(["point", contour.start]);
    else {
      const s = contour.segments;
      if (s.length === 2 && s.every(segment => segment.type === "ellipse") &&
          key(s[1].end) === key(contour.start) &&
          key(ellipseShape(contour.start, s[0] as Extract<SketchSegment, { type: "ellipse" }>)) ===
          key(ellipseShape(s[0].end, s[1] as Extract<SketchSegment, { type: "ellipse" }>))) {
        signature = key(["ellipse-ring", ellipseShape(contour.start, s[0] as Extract<SketchSegment, { type: "ellipse" }>)]);
      } else {
        let start = contour.start;
        const parts = s.map(segment => {
          const result = segmentKey(start, segment);
          start = segment.end;
          return result;
        });
        signature = [key(parts), key([...parts].reverse())].sort()[0];
      }
    }
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}
