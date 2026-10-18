import { describe, expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three/webgpu';
import { cameraVerticalSpan, changeCameraProjection, resizeModelingCamera } from './camera-projection';

function setup() {
  const camera = new PerspectiveCamera(42, 1.6, 0.1, 10000);
  const target = new Vector3(12, -7, 3);
  camera.position.copy(target).add(new Vector3(0, 0, 100));
  camera.lookAt(target); camera.updateMatrixWorld(true);
  return { camera, target };
}
describe('modeling projection', () => {
  it('preserves target-plane size, orientation and position on switching to orthographic', () => {
    const { camera, target } = setup();
    camera.zoom = 1.7; camera.updateProjectionMatrix();
    const point = target.clone().add(new Vector3(8, 12, 0));
    const before = point.clone().project(camera);
    const ortho = changeCameraProjection(camera, target, 'orthographic', 42);
    const after = point.clone().project(ortho);
    expect(ortho).toBeInstanceOf(OrthographicCamera);
    expect(after.x).toBeCloseTo(before.x, 10); expect(after.y).toBeCloseTo(before.y, 10);
    expect(ortho.position.equals(camera.position)).toBe(true);
    expect(ortho.quaternion.equals(camera.quaternion)).toBe(true);
  });
  it('keeps parallel geometry the same size at different depths and supports picking', () => {
    const { camera, target } = setup();
    const ortho = changeCameraProjection(camera, target, 'orthographic', 42);
    const a = target.clone().add(new Vector3(5, 4, 0)).project(ortho);
    const b = target.clone().add(new Vector3(5, 4, -50)).project(ortho);
    expect(a.x).toBeCloseTo(b.x, 10); expect(a.y).toBeCloseTo(b.y, 10);
    const ray = new Raycaster(); ray.setFromCamera(new Vector2(0, 0), ortho);
    expect(ray.ray.distanceToPoint(target)).toBeLessThan(1e-8);
  });
  it('preserves the zoomed orthographic scale when returning to perspective', () => {
    const { camera, target } = setup();
    const ortho = changeCameraProjection(camera, target, 'orthographic', 42);
    ortho.zoom = 2.5; ortho.updateProjectionMatrix();
    const perspective = changeCameraProjection(ortho, target, 'perspective', 60);
    expect(cameraVerticalSpan(perspective, target)).toBeCloseTo(cameraVerticalSpan(ortho, target), 10);
    expect(perspective.quaternion.equals(ortho.quaternion)).toBe(true);
    expect(changeCameraProjection(perspective, target, 'perspective', 60)).toBe(perspective);
  });
  it('resizes portrait and landscape viewports without changing vertical scale', () => {
    const { camera, target } = setup();
    const ortho = changeCameraProjection(camera, target, 'orthographic', 42) as OrthographicCamera;
    const span = cameraVerticalSpan(ortho, target);
    for (const aspect of [0.5, 2]) {
      resizeModelingCamera(ortho, aspect);
      expect((ortho.right - ortho.left) / (ortho.top - ortho.bottom)).toBeCloseTo(aspect);
      expect(cameraVerticalSpan(ortho, target)).toBe(span);
    }
  });
});
