import { expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, PerspectiveCamera, PlaneGeometry, Vector3 } from 'three/webgpu';
import { OrientationPreviewMotion, visiblePreviewBounds } from './orientation-preview';

it('includes visible bodies, planes and sketches without changing visibility or including suppressed descendants', () => {
  const root = new Group(), hidden = new Group();
  const body = new Mesh(new BoxGeometry(10, 10, 10));
  const plane = new Mesh(new PlaneGeometry(200, 100)); plane.position.set(50, 0, 0);
  const sketch = new Mesh(new PlaneGeometry(20, 20)); sketch.position.set(0, 120, 0);
  const suppressed = new Mesh(new BoxGeometry(9000, 9000, 9000));
  hidden.add(suppressed); hidden.visible = false;
  root.add(body, plane, sketch, hidden);
  const bounds = visiblePreviewBounds([root]);
  expect(bounds.min.toArray()).toEqual([-50, -50, -5]);
  expect(bounds.max.toArray()).toEqual([150, 130, 5]);
  expect([root.visible, plane.visible, sketch.visible, hidden.visible]).toEqual([true, true, true, false]);
  root.visible = false; expect(visiblePreviewBounds([root]).isEmpty()).toBe(true);
});

it('eases from the current pose to the preview while preserving viewing direction and roll', () => {
  const camera = new PerspectiveCamera(); camera.position.set(30, -100, 20); camera.up.set(0, 0, 1);
  const target = new Vector3(30, 0, 20), motion = new OrientationPreviewMotion();
  motion.start(camera, target, new Vector3(0, -400, 0), new Vector3(), 1000, 400);
  motion.update(camera, target, 1000); expect(camera.position.toArray()).toEqual([30, -100, 20]);
  motion.update(camera, target, 1100); const first = camera.position.distanceTo(target);
  expect(first).toBeGreaterThan(100); expect(first).toBeLessThan(175);
  motion.update(camera, target, 1200); expect(camera.position.distanceTo(target)).toBeCloseTo(250);
  expect(camera.position.clone().sub(target).normalize().toArray()).toEqual([0, -1, 0]);
  expect(camera.up.toArray()).toEqual([0, 0, 1]);
  motion.update(camera, target, 1400); expect(camera.position.toArray()).toEqual([0, -400, 0]);
  expect(target.toArray()).toEqual([0, 0, 0]); expect(motion.update(camera, target, 1500)).toBe(false);
});

it('cancels without a jump, and rapid re-entry starts at the current pose', () => {
  const camera = new PerspectiveCamera(); camera.position.z = 100;
  const target = new Vector3(), motion = new OrientationPreviewMotion();
  motion.start(camera, target, new Vector3(0, 0, 400), target, 0, 400);
  motion.update(camera, target, 100); motion.cancel(); const stopped = camera.position.clone();
  expect(motion.update(camera, target, 400)).toBe(false); expect(camera.position.equals(stopped)).toBe(true);
  motion.start(camera, target, new Vector3(0, 0, 400), target, 500, 400);
  motion.update(camera, target, 500); expect(camera.position.equals(stopped)).toBe(true);
  motion.start(camera, target, new Vector3(0, 0, 400), target, 600, 0);
  motion.update(camera, target, 600); expect(camera.position.z).toBe(400);
});
