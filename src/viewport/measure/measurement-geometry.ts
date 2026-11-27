/** Display measurements in millimetres; geometry is supplied by the CAD viewer. */
export type MeasurePoint = readonly [number, number, number];
export type MeasurementMode = 'Objects' | 'Point-to-point' | '3-point angle';
export const MEASUREMENT_MODES: readonly MeasurementMode[] = ['Objects', 'Point-to-point', '3-point angle'];
export const pointDistance = (a: MeasurePoint, b: MeasurePoint) => Math.hypot(...a.map((value, axis) => value - b[axis]));
/** The second picked point is the vertex. Reject zero arms instead of showing NaN. */
export function threePointAngle(a: MeasurePoint, vertex: MeasurePoint, b: MeasurePoint): number | null {
  const u = a.map((value, axis) => value - vertex[axis]);
  const v = b.map((value, axis) => value - vertex[axis]);
  const scale = Math.hypot(...u) * Math.hypot(...v);
  if (!Number.isFinite(scale) || scale < 1e-12) return null;
  return Math.acos(Math.max(-1, Math.min(1, u.reduce((sum, value, axis) => sum + value * v[axis], 0) / scale)));
}
