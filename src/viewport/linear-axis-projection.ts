import { Raycaster, Vector2, Vector3, type Camera } from 'three/webgpu';
import { extrusionAxisDepth } from './extrusion-axis';

type Rect = { left: number; top: number; width: number; height: number };
export type LinearAxisProjection = {
  x: number;
  y: number;
  axisView?: 'toward' | 'away';
  depthAt(x: number, y: number): number | null;
};

/** Frozen camera mapping shared by every linear feature control. End-on axes
 * have no measurable screen direction: use a view-scale vertical scrub, with
 * explicit toward/away artwork, instead of dividing by an almost parallel ray. */
export function projectLinearAxis(camera: Camera, rect: Rect, origin: Vector3, axis: Vector3, depth: number): LinearAxisProjection | null {
  if (rect.width <= 0 || rect.height <= 0 || ![...origin.toArray(), ...axis.toArray(), depth].every(Number.isFinite) || Math.abs(axis.length() - 1) > 1e-6) return null;
  const frozen = camera.clone(); frozen.updateMatrixWorld(true);
  const base = origin.clone(), direction = axis.clone();
  const point = base.clone().addScaledVector(direction, depth), projected = point.clone().project(frozen);
  if (![projected.x, projected.y, projected.z].every(Number.isFinite) || projected.z < -1 || projected.z > 1) return null;
  const screen = { x: rect.left + (projected.x + 1) * rect.width / 2, y: rect.top + (1 - projected.y) * rect.height / 2 };
  const rayAt = (x: number, y: number) => {
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2), frozen);
    return ray.ray;
  };
  const at = rayAt(screen.x, screen.y);
  // An off-center part in a perspective Top/Bottom view has a tilted pointer
  // ray even though its axis faces the viewer. Keep all such controls end-on.
  const viewCosine = direction.dot(frozen.getWorldDirection(new Vector3()));
  if (1 - viewCosine * viewCosine >= .0025 && extrusionAxisDepth(at, base, direction) !== null) {
    return { ...screen, depthAt: (x, y) => extrusionAxisDepth(rayAt(x, y), base, direction) };
  }
  const onePixel = projected.clone(); onePixel.y += 2 / rect.height;
  const perPixel = onePixel.unproject(frozen).distanceTo(point);
  if (!Number.isFinite(perPixel) || perPixel <= 0) return null;
  return { ...screen, axisView: direction.dot(at.direction) < 0 ? 'toward' : 'away',
    depthAt: (_x, y) => Number.isFinite(y) ? depth + (screen.y - y) * perPixel : null };
}
