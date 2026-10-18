import type { SketchDrawing, SketchPoint } from '@aether/core/sketch';
export const isRectanglePlacement = (tool: string) => tool === 'rectangle' || tool === 'center-rectangle';
/** Pointer geometry for the existing rectangle primitive, shared by preview and commit. */
export function squareCorner(start: SketchPoint, end: SketchPoint): SketchPoint {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return [start[0] + (dx < 0 ? -side : side), start[1] + (dy < 0 ? -side : side)];
}
/** Compose the existing Equal relation; do not save an independent square flag. */
export function constrainPlacedSquare(drawing: SketchDrawing, contour: number) {
  const next = structuredClone(drawing);
  let id = 'rectangle-equal';
  while (next.constraints?.some(c => c.id === id)) id += '-';
  (next.constraints ??= []).push({ id, kind: 'equal', a: { contour, kind: 'line', index: 0 }, b: { contour, kind: 'line', index: 1 } });
  return next;
}
