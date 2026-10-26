import { expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { defaultCADAppearance } from '../cad-appearance-store';
import { resolveAppearance } from './appearance-themes';
import { perspectiveDepthRange, StageRig } from './stage-rig';

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

it('keeps orthographic ground visible beyond the old finite grid when zooming far out', () => {
  const rig = new StageRig(new Scene()); rig.setUpAxis('z');
  rig.apply(resolveAppearance(defaultCADAppearance), defaultCADAppearance); rig.frame(60, 160);
  const camera = new OrthographicCamera(-100, 100, 80, -80, .1, 1000);
  camera.position.set(0, -100, 100); camera.up.set(0, 0, 1); camera.lookAt(0, 0, 0);
  camera.zoom = .001; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  rig.beforeRender(camera, new Vector3(), []);
  expect(camera.far).toBeGreaterThanOrEqual(rig.grid.reach(camera.position));
  expect(camera.near).toBe(-camera.far);
  const nearCorner = new Vector3(0, -100000, -.01).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  expect(Math.abs(nearCorner.z)).toBeLessThan(1);
});

it('keeps perspective depth precision when panning far from the world origin', () => {
  const rig = new StageRig(new Scene()); rig.setUpAxis('z');
  rig.apply(resolveAppearance(defaultCADAppearance), defaultCADAppearance); rig.frame(60, 160);
  const camera = new PerspectiveCamera(50, 1.5, .1, 1000);
  camera.position.set(0, -100, 100); camera.up.set(0, 0, 1); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  rig.beforeRender(camera, new Vector3(), []);
  const initial = { near: camera.near, far: camera.far };
  camera.position.x += 1e7; camera.updateMatrixWorld();
  rig.beforeRender(camera, new Vector3(1e7, 0, 0), []);
  expect(camera.near).toBeCloseTo(initial.near); expect(camera.far).toBeCloseTo(initial.far);
});
