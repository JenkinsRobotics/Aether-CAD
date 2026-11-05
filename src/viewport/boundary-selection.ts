import { Raycaster, Vector2, type Camera } from 'three/webgpu';
import type { CADSelectionFilter } from '../cad-selection-store';

/** A projected edge can round just outside its adjacent triangle. Check the
 * surrounding pixel footprint only when the ordinary pick misses. Every probe uses
 * the usual visible-surface rule, so hidden edges never become through-picks. */
export function pickBoundarySelection<T extends { item: { kind: string } }>(
  ray: Raycaster, camera: Camera,
  viewport: { left: number; top: number; width: number; height: number },
  pointer: { clientX: number; clientY: number }, filter: CADSelectionFilter,
  pick: (probe: Raycaster) => T | null,
): T | null {
  const direct = pick(ray);
  if (direct || !['auto', 'edge', 'vertex'].includes(filter)) return direct;
  if (!(viewport.width > 0 && viewport.height > 0)) return null;
  const probe = new Raycaster(); probe.near = ray.near; probe.far = ray.far;
  probe.layers.mask = ray.layers.mask;
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    // Some browsers truncate both coordinates: the diagonal error can reach
    // sqrt(2) CSS pixels even for a pointer exactly on the projected boundary.
    const x = pointer.clientX - viewport.left + 1.5 * Math.cos(angle);
    const y = pointer.clientY - viewport.top + 1.5 * Math.sin(angle);
    probe.setFromCamera(new Vector2(x / viewport.width * 2 - 1, 1 - y / viewport.height * 2), camera);
    const hit = pick(probe);
    if (hit?.item.kind === 'edge' || hit?.item.kind === 'vertex') return hit;
  }
  return null;
}
