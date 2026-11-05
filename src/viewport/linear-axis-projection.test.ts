import { expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { projectLinearAxis } from './linear-axis-projection';

const rect = { left: 30, top: 50, width: 1200, height: 800 };
function camera(kind: string, position: Vector3) {
  const result = kind === 'orthographic' ? new OrthographicCamera(-150, 150, 100, -100, .1, 10000) : new PerspectiveCamera(45, 1.5, .1, 10000);
  result.position.copy(position); result.lookAt(0, 0, 0); result.updateMatrixWorld(true); return result;
}
it.each(['orthographic', 'perspective'])('keeps %s end-on controls finite, signed and frozen throughout a drag', kind => {
  const view = camera(kind, new Vector3(0, 0, 100));
  const origin = new Vector3(), normal = new Vector3(0, 0, 1);
  const toward = projectLinearAxis(view, rect, origin, normal, 10)!;
  expect(toward.axisView).toBe('toward');
  expect(toward.depthAt(toward.x, toward.y)).toBeCloseTo(10);
  const up = toward.depthAt(toward.x, toward.y - 40)!;
  expect(up).toBeGreaterThan(10); expect(up).toBeLessThan(30);
  expect(toward.depthAt(toward.x + 100, toward.y - 40)).toBe(up);
  expect(toward.depthAt(toward.x, toward.y + 1000)).toBeLessThan(0);
  const away = projectLinearAxis(view, rect, origin, normal.clone().negate(), 10)!;
  expect(away.axisView).toBe('away'); expect(away.depthAt(away.x, away.y - 40)).toBeGreaterThan(10);
  view.position.set(200, 300, 400); view.updateMatrixWorld(true); origin.set(99, 99, 99); normal.set(1, 0, 0);
  expect(toward.depthAt(toward.x, toward.y - 40)).toBe(up);
});
it.each(['orthographic', 'perspective'])('preserves exact projected depths in an oblique %s view', kind => {
  const view = camera(kind, new Vector3(100, -100, 100));
  const origin = new Vector3(5, 3, 0), axis = new Vector3(.6, 0, .8);
  const handle = projectLinearAxis(view, rect, origin, axis, 20)!;
  expect(handle.axisView).toBeUndefined();
  for (const depth of [-20, 0, 15, 60]) {
    const p = origin.clone().addScaledVector(axis, depth).project(view);
    expect(handle.depthAt(rect.left + (p.x + 1) * rect.width / 2, rect.top + (1 - p.y) * rect.height / 2)).toBeCloseTo(depth, 7);
  }
});
it('uses a bounded scrub for nearly parallel views and refuses unavailable geometry', () => {
  const view = camera('perspective', new Vector3(1, 0, 100));
  expect(projectLinearAxis(view, rect, new Vector3(), new Vector3(0, 0, 1), 0)?.axisView).toBe('toward');
  expect(projectLinearAxis(view, { ...rect, height: 0 }, new Vector3(), new Vector3(0, 0, 1), 1)).toBeNull();
  expect(projectLinearAxis(view, rect, new Vector3(), new Vector3(), 1)).toBeNull();
  expect(projectLinearAxis(view, rect, new Vector3(), new Vector3(0, 0, 1), Infinity)).toBeNull();
  expect(projectLinearAxis(view, rect, new Vector3(0, 0, 200), new Vector3(0, 0, 1), 0)).toBeNull();
});
it.each([100,-100])('keeps an off-center perspective part end-on from camera Z=%s', z => {
  const view = camera('perspective', new Vector3(0, 0, z));
  const projection = projectLinearAxis(view, rect, new Vector3(35, 0, 0), new Vector3(0, 0, 1), 10)!;
  expect(projection.axisView).toBe(z > 0 ? 'toward' : 'away');
  expect(projection.depthAt(projection.x, projection.y)).toBeCloseTo(10);
  expect(projection.depthAt(projection.x, projection.y - 30)).toBeGreaterThan(10);
});
