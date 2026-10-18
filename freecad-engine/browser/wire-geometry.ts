import type { SketchPoint, SketchSegment } from '../../aether-engine/src/sketch/drawing';
import { ellipseFrame } from '../../aether-engine/src/sketch/curves/parameterization';

/** The existing exact endpoint-arc convention is the single geometric truth.
 * FreeCAD consumes its center/axes frame rather than an approximating polyline. */
export function nativeWireSegments(start: SketchPoint, segments: readonly SketchSegment[]) {
  let current = start;
  return segments.map(segment => {
    const native = segment.type === 'ellipse'
      ? { ...segment, ellipse_frame: ellipseFrame(current, segment) }
      : structuredClone(segment);
    current = segment.end;
    return native;
  });
}
