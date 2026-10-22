import { expect, it } from 'vitest';
import { perspectiveDepthRange } from './stage-rig';

it('keeps the depth range near the reference demo’s ~2000:1 so coplanar faces, edges and floor never fight', () => {
  // Demo: camera ~10 m from the model, near .05 m, far 100 m.
  expect(perspectiveDepthRange(10, 0, 0)).toEqual({ near: 0.05, far: 100 });
  for (const distance of [5, 150, 2_000, 80_000]) {
    const { near, far } = perspectiveDepthRange(distance, distance * 1.5, distance * 4);
    expect(far / near).toBeLessThanOrEqual(2_000 * 4 + 1);
    expect(near).toBeGreaterThan(0);
  }
  // Content or grid farther than 10× distance widens far; near never collapses below far/50,000.
  expect(perspectiveDepthRange(100, 0, 1e7)).toEqual({ near: 200, far: 1e7 });
});
