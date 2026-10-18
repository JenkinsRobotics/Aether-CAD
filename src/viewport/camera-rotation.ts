import { Matrix4, Camera, Quaternion, Vector3 } from 'three/webgpu';
import type { CameraOrientationBasis } from '../camera-view';

/** Animate a ViewCube rotation as a rigid camera basis. A roll rotates only
 * screen-up, never the eye around a world axis or through a pole. */
export class CameraRotationMotion {
  private move: { from: Quaternion; to: Quaternion; center: Vector3; distance: number; started: number; duration: number } | null = null;

  basis(camera: Camera, target: Vector3): CameraOrientationBasis {
    if (this.move) return {
      direction: new Vector3(0, 0, 1).applyQuaternion(this.move.to).toArray(),
      up: new Vector3(0, 1, 0).applyQuaternion(this.move.to).toArray(),
    };
    return { direction: camera.position.clone().sub(target).normalize().toArray(), up: camera.up.toArray() };
  }

  start(camera: Camera, target: Vector3, basis: CameraOrientationBasis, now: number, duration = 300): void {
    camera.lookAt(target);
    const to = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(...basis.direction), new Vector3(), new Vector3(...basis.up)));
    this.move = { from: camera.quaternion.clone(), to, center: target.clone(), distance: camera.position.distanceTo(target), started: now, duration };
  }

  cancel(): void { this.move = null; }

  update(camera: Camera, target: Vector3, now: number): boolean {
    const move = this.move;
    if (!move) return false;
    const t = move.duration <= 0 ? 1 : Math.max(0, Math.min(1, (now - move.started) / move.duration));
    const q = move.from.clone().slerp(move.to, t * t * (3 - 2 * t));
    target.copy(move.center);
    camera.position.set(0, 0, move.distance).applyQuaternion(q).add(move.center);
    camera.up.set(0, 1, 0).applyQuaternion(q);
    camera.quaternion.copy(q);
    if (t === 1) this.move = null;
    return true;
  }
}
