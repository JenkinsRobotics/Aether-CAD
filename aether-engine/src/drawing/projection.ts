import type { DrawingOrientation, DrawingPoint } from "./document";

/** All coordinates are in view-plane mm (Y up). Approximate curves are explicitly
 * identified; dimensions use OCCT's curve bounds, never their display samples. */
export type ProjectedDrawingCurve =
  | { kind: "line"; start: DrawingPoint; end: DrawingPoint }
  | { kind: "circle"; center: DrawingPoint; radius: number }
  | { kind: "arc"; center: DrawingPoint; radius: number; start: number; end: number; ccw: boolean }
  | { kind: "polyline"; points: DrawingPoint[]; toleranceMm: number };
export interface PartDrawingProjection {
  visible: ProjectedDrawingCurve[];
  hidden: ProjectedDrawingCurve[];
  bounds: [number, number, number, number];
  bodyIds: string[];
}
export interface PartDrawingOptions { orientation: DrawingOrientation; bodyIds?: string[] }
export function drawingViewFrame(orientation: DrawingOrientation): { normal: [number, number, number]; up: [number, number, number] } {
  switch (orientation) {
    case "front": return { normal: [0, -1, 0], up: [0, 0, 1] };
    case "back": return { normal: [0, 1, 0], up: [0, 0, 1] };
    case "top": return { normal: [0, 0, 1], up: [0, 1, 0] };
    case "bottom": return { normal: [0, 0, -1], up: [0, -1, 0] };
    case "right": return { normal: [1, 0, 0], up: [0, 0, 1] };
    case "left": return { normal: [-1, 0, 0], up: [0, 0, 1] };
    case "isometric": return { normal: [1, -1, 1], up: [0, 0, 1] };
    default: throw Error("Unknown drawing orientation.");
  }
}
