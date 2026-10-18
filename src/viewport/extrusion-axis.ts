import type { Ray, Vector3 } from 'three/webgpu';
/** Closest point of the pointer ray on a unit extrusion axis, in world mm. */
export function extrusionAxisDepth(ray: Ray, origin: Vector3, normal: Vector3): number | null {
  const offset = ray.origin.clone().sub(origin);
  const cosine = normal.dot(ray.direction);
  const denominator = 1 - cosine * cosine;
  // An end-on axis has no stable screen-space drag; retain the numeric control.
  if (denominator < 0.0025) return null;
  return (normal.dot(offset) - cosine * ray.direction.dot(offset)) / denominator;
}
