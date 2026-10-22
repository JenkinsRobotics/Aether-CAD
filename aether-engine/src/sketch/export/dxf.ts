import type { SketchDrawing, SketchPoint } from "../drawing";
import { sketchContourPolyline } from "../sample";

/** Save As DXF (SolidCraft's sketch.export_dxf): lines, circles and arcs exactly,
 *  other curves as polylines, in millimetres (INSUNITS 4). Construction geometry
 *  goes on its own layer. */
export function sketchDrawingToDXF(drawing: SketchDrawing): string {
  const out: string[] = [];
  const tag = (code: number, value: string | number) => { out.push(String(code), typeof value === "number" ? formatNumber(value) : value); };
  tag(0, "SECTION"); tag(2, "HEADER"); tag(9, "$INSUNITS"); tag(70, 4); tag(0, "ENDSEC");
  tag(0, "SECTION"); tag(2, "ENTITIES");
  for (const contour of drawing.contours) {
    const layer = contour.construction ? "CONSTRUCTION" : "0";
    if (contour.type === "circle") { tag(0, "CIRCLE"); tag(8, layer); tag(10, contour.center[0]); tag(20, contour.center[1]); tag(30, 0); tag(40, contour.radius); continue; }
    if (contour.type !== "path") continue;
    let from = contour.start;
    for (const segment of contour.segments) {
      if (segment.type === "line") { tag(0, "LINE"); tag(8, layer); tag(10, from[0]); tag(20, from[1]); tag(30, 0); tag(11, segment.end[0]); tag(21, segment.end[1]); tag(31, 0); }
      else if (segment.type === "arc") {
        const arc = arcThrough(from, segment.middle, segment.end);
        if (arc) { tag(0, "ARC"); tag(8, layer); tag(10, arc.center[0]); tag(20, arc.center[1]); tag(30, 0); tag(40, arc.radius); tag(50, arc.startDegrees); tag(51, arc.endDegrees); }
        else { tag(0, "LINE"); tag(8, layer); tag(10, from[0]); tag(20, from[1]); tag(30, 0); tag(11, segment.end[0]); tag(21, segment.end[1]); tag(31, 0); }
      } else {
        const points = sketchContourPolyline({ type: "path", start: from, segments: [segment] });
        tag(0, "LWPOLYLINE"); tag(8, layer); tag(90, points.length); tag(70, 0);
        for (const p of points) { tag(10, p[0]); tag(20, p[1]); }
      }
      from = segment.end;
    }
  }
  tag(0, "ENDSEC"); tag(0, "EOF");
  return out.join("\n") + "\n";
}

function formatNumber(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, "").replace(/\.$/, ""); }

/** Centre, radius and counterclockwise start/end angles of the arc through three points. */
function arcThrough(a: SketchPoint, m: SketchPoint, b: SketchPoint): { center: SketchPoint; radius: number; startDegrees: number; endDegrees: number } | null {
  const dx = m[0] - a[0], dy = m[1] - a[1], ux = b[0] - a[0], uy = b[1] - a[1], det = 2 * (dx * uy - dy * ux);
  if (Math.abs(det) < 1e-12) return null;
  const q = dx * dx + dy * dy, r = ux * ux + uy * uy;
  const center: SketchPoint = [a[0] + (q * uy - r * dy) / det, a[1] + (dx * r - ux * q) / det];
  const radius = Math.hypot(a[0] - center[0], a[1] - center[1]);
  const deg = (p: SketchPoint) => ((Math.atan2(p[1] - center[1], p[0] - center[0]) * 180 / Math.PI) + 360) % 360;
  // DXF arcs run counterclockwise from start to end: a clockwise arc is written reversed.
  const clockwise = det < 0;
  return { center, radius, startDegrees: deg(clockwise ? b : a), endDegrees: deg(clockwise ? a : b) };
}
