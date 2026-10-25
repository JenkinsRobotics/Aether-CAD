import type { SketchFrame, SketchPoint } from "../../sketch/drawing";
import { cross, dot, sub, type V3 } from "../vector";

export type NativePoint = { X(): number; Y(): number; Z(): number; delete(): void };

/** Returned OCCT points/directions are owned wrappers, including accessor results. */
export function takePoint(point: NativePoint): V3 {
  try { return [point.X(), point.Y(), point.Z()]; }
  finally { point.delete(); }
}

export function projectionFrame(frame: SketchFrame) {
  const y = cross(frame.normal, frame.xDirection);
  const vector = (v: V3): SketchPoint => [dot(v, frame.xDirection), dot(v, y)];
  return {
    vector,
    point: (p: V3): SketchPoint => vector(sub(p, frame.originMillimeters)),
  };
}
