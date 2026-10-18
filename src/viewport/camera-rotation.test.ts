import { expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { cameraViewDefinition, nudgeCameraBasis, rollCameraBasis } from '../camera-view';
import { CameraRotationMotion } from './camera-rotation';

it.each(['y', 'z'] as const)('rolls on the viewing axis through intermediate angles without moving the eye (%s-up)', axis => {
  for (const view of ['front', 'back', 'top', 'bottom', 'isometric'] as const) {
    for (const sign of [-1, 1]) {
      const basis = rollCameraBasis(cameraViewDefinition(view, axis), 0);
      const camera = new PerspectiveCamera(), target = new Vector3(12, 30, -8);
      camera.position.copy(target).addScaledVector(new Vector3(...basis.direction), 100); camera.up.set(...basis.up);
      const position = camera.position.clone(), up = camera.up.clone(), motion = new CameraRotationMotion();
      motion.start(camera, target, rollCameraBasis(basis, sign * Math.PI / 2), 0, 300);
      for (const t of [0, 75, 150, 225, 300]) {
        motion.update(camera, target, t);
        expect(camera.position.distanceTo(position)).toBeLessThan(1e-8);
        expect(target.toArray()).toEqual([12, 30, -8]);
        if (t === 150) {
          expect(camera.up.dot(up)).toBeCloseTo(Math.SQRT1_2, 10);
          const expected = new Vector3(...rollCameraBasis(basis, sign * Math.PI / 4).up);
          expect(camera.up.distanceTo(expected)).toBeLessThan(1e-8);
        }
      }
    }
  }
});

it('accumulates repeated nudges without jumping on click and stops when interrupted', () => {
  const camera = new PerspectiveCamera(), target = new Vector3(), motion = new CameraRotationMotion();
  camera.position.set(0, 0, 100); camera.up.set(0, 1, 0);
  motion.start(camera, target, nudgeCameraBasis(motion.basis(camera, target), Math.PI / 12, 0), 0);
  motion.update(camera, target, 100); const midway = camera.position.clone();
  motion.start(camera, target, nudgeCameraBasis(motion.basis(camera, target), Math.PI / 12, 0), 100);
  motion.update(camera, target, 100); expect(camera.position.distanceTo(midway)).toBeLessThan(1e-8);
  motion.update(camera, target, 400); expect(camera.position.x).toBeCloseTo(50, 8);
  motion.start(camera, target, rollCameraBasis(motion.basis(camera, target), Math.PI / 2), 500);
  motion.update(camera, target, 600); motion.cancel(); const up = camera.up.clone();
  expect(motion.update(camera, target, 1000)).toBe(false); expect(camera.up.equals(up)).toBe(true);
});

it('respects zero-duration reduced motion', () => {
  const camera = new PerspectiveCamera(), target = new Vector3(), motion = new CameraRotationMotion();
  camera.position.z = 100;
  motion.start(camera, target, rollCameraBasis(motion.basis(camera, target), Math.PI / 2), 0, 0);
  motion.update(camera, target, 0); expect(camera.up.x).toBeCloseTo(-1); expect(camera.position.z).toBeCloseTo(100);
});
