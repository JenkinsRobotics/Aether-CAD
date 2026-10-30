import { isShape3D, measureVolume, type Shape3D } from 'replicad';

/** Explicit scope keeps missed parts unchanged. Use the boolean's own volume
 * to detect overlap instead of intersecting first and performing it twice.
 * Every temporary result is owned by the caller's replay step. */
export function scopedRemoval(
  target: Shape3D,
  tool: Shape3D,
  operation: 'cut' | 'intersect',
  own: <T>(value: T) => T,
): { shape: Shape3D; volume: number; removed: number } {
  const before = measureVolume(target);
  const a = target.boundingBox.bounds, b = tool.boundingBox.bounds;
  if ([0, 1, 2].some(axis => a[1][axis] < b[0][axis] - 1e-7 || b[1][axis] < a[0][axis] - 1e-7))
    return { shape: target, volume: before, removed: 0 };
  const result = own(operation === 'cut' ? target.cut(tool) : target.intersect(tool));
  const after = isShape3D(result) ? measureVolume(result) : 0;
  const removed = Math.max(0, before - after);
  const missed = operation === 'cut' ? removed <= 1e-9 : after <= 1e-9;
  return missed ? { shape: target, volume: before, removed: 0 } : { shape: result, volume: after, removed };
}
