import type { SketchPoint, SketchContour } from "@aether/core/sketch";
import { conicDisplayPolyline } from '../../freecad-engine/browser/conic-geometry';
import { arcPath } from '@aether/sketch';
export { arcPath } from '@aether/sketch';
export function contourPath(c: Extract<SketchContour, { type: "path" }>) {
  let a = c.start,
    d = `M${a[0]},${-a[1]}`;
  for (const seg of c.segments) {
    if (seg.type==='conic') {
      d+=conicDisplayPolyline(a,seg).slice(1).map(p=>`L${p[0]},${-p[1]}`).join('');
      a=seg.end;continue;
    }
    const end: SketchPoint = [seg.end[0], -seg.end[1]];
    d +=
      seg.type === "line"
        ? `L${end}`
        : seg.type === "bezier"
          ? `C${seg.controls.map((p) => [p[0], -p[1]].join(",")).join(" ")} ${end}`
          : seg.type === "ellipse"
            ? `A${seg.radiusX} ${seg.radiusY} ${-seg.rotationDegrees} ${seg.largeArc ? 1 : 0} ${seg.sweep ? 0 : 1} ${end}`
            : arcPath([a[0], -a[1]], [seg.middle[0], -seg.middle[1]], end);
    a = seg.end;
  }
  return d;
}
