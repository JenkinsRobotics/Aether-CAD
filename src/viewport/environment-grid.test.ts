import { expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { niceGridStep, stageGridFraming } from './environment-grid';
import { GRID_HORIZON, gridAngleOpacity, gridFootprint, gridLevels } from './horizon-grid';

it('steps through the 1-2-5 series and fits initial cells to the model', () => {
  expect([0.7, 1, 3, 7.5, 19, 20, 49, 120].map(niceGridStep)).toEqual([0.5, 1, 2, 5, 10, 20, 20, 100]);
  expect(stageGridFraming(5000)).toEqual({ spacing: 1000 });
  expect(stageGridFraming(60)).toEqual({ spacing: 10 });
});

it('fades only grazing rays and preserves the same envelope across camera distances', () => {
  expect(gridAngleOpacity(0)).toBe(0);
  expect(gridAngleOpacity(GRID_HORIZON.hidden)).toBe(0);
  expect(gridAngleOpacity(GRID_HORIZON.visible)).toBe(1);
  expect(gridAngleOpacity(1)).toBe(1);
  for (const angle of [0, 3, 8, 16, 45, 90]) {
    const ray = new Vector3(0, Math.cos(angle * Math.PI / 180), Math.sin(angle * Math.PI / 180));
    const opacity = gridAngleOpacity(ray.z);
    for (const distance of [0.01, 40, 160, 1200, 50_000, 1e7]) {
      expect(gridAngleOpacity(ray.clone().multiplyScalar(distance).normalize().z)).toBeCloseTo(opacity, 12);
    }
    expect(gridAngleOpacity(-ray.z)).toBe(opacity);
  }
});

it.each(['y', 'z'] as const)('covers visible ground rays after zoom and pan with %s up', up => {
  const camera = new PerspectiveCamera(50, 2, .01, 1e8);
  const normal = new Vector3(0, up === 'y' ? 1 : 0, up === 'z' ? 1 : 0);
  for (const scale of [0.001, 1, 1000]) {
    camera.position.set(80 * scale, 100 * scale, 140 * scale);
    camera.up.copy(normal); camera.lookAt(new Vector3(30 * scale, 0, 0)); camera.updateMatrixWorld();
    const { center, half } = gridFootprint(camera, up, 0);
    for (let x = -1; x <= 1; x += .1) for (let y = -1; y <= 1; y += .1) {
      const ray = new Vector3(x, y, .5).unproject(camera).sub(camera.position).normalize();
      const t = -camera.position[up] / ray[up];
      if (t <= 0 || Math.abs(ray[up]) <= GRID_HORIZON.hidden) continue;
      const hit = camera.position.clone().addScaledVector(ray, t).sub(center);
      expect(Math.abs(hit.x)).toBeLessThan(half);
      expect(Math.abs(hit[up === 'y' ? 'z' : 'y'])).toBeLessThan(half);
    }
  }
});

it('covers orthographic corners at all zoom levels and viewing angles', () => {
  const camera = new OrthographicCamera(-200, 200, 100, -100, .01, 1e8);
  camera.up.set(0, 0, 1);
  for (const zoom of [.001, 1, 100]) for (const elevation of [3, 30, 90]) {
    const angle = elevation * Math.PI / 180;
    camera.position.set(0, -200 * Math.cos(angle), 200 * Math.sin(angle));
    camera.lookAt(0, 0, 0); camera.zoom = zoom; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    const { center, half } = gridFootprint(camera, 'z', 0), direction = camera.getWorldDirection(new Vector3());
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const origin = new Vector3(x, y, -1).unproject(camera);
      const hit = origin.addScaledVector(direction, -origin.z / direction.z).sub(center);
      expect(Math.abs(hit.x)).toBeLessThan(half); expect(Math.abs(hit.y)).toBeLessThan(half);
    }
  }
});

it('crossfades grid scales continuously without moving world-aligned axes', () => {
  expect(gridLevels(10, 100)).toEqual({ spacing: 10, blend: 0 });
  for (const boundary of [5000, 50000, 500000]) {
    const before = gridLevels(10, boundary * (1 - 1e-8)), after = gridLevels(10, boundary * (1 + 1e-8));
    expect(before.spacing * 10).toBe(after.spacing);
    expect(before.blend).toBeCloseTo(1, 6); expect(after.blend).toBeCloseTo(0, 6);
  }
});
