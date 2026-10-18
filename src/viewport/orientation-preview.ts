import { Box3, BufferGeometry, Object3D, Camera, Vector3 } from 'three/webgpu';

/** Only rendered objects contribute. Box3.setFromObject also includes hidden
 * descendants, which can make suppressed features dominate the preview fit. */
export function visiblePreviewBounds(roots: readonly Object3D[]): Box3 {
  const bounds = new Box3();
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverseVisible(object => {
      const geometry = (object as Object3D & { geometry?: BufferGeometry }).geometry;
      if (!geometry) return;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (geometry.boundingBox) bounds.union(geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    });
  }
  return bounds;
}

/** Runs on the viewport's render clock, so WebGL and the live sketch CSS3D
 * surface see the exact same camera throughout the step back. */
export class OrientationPreviewMotion {
  private move: { position: Vector3; target: Vector3; endPosition: Vector3; endTarget: Vector3; started: number; duration: number } | null = null;

  start(camera: Camera, target: Vector3, endPosition: Vector3, endTarget: Vector3, now: number, duration = 420): void {
    this.move = { position: camera.position.clone(), target: target.clone(), endPosition: endPosition.clone(), endTarget: endTarget.clone(), started: now, duration };
  }

  cancel(): void { this.move = null; }

  update(camera: Camera, target: Vector3, now: number): boolean {
    const move = this.move;
    if (!move) return false;
    const progress = move.duration <= 0 ? 1 : Math.max(0, Math.min(1, (now - move.started) / move.duration));
    const eased = progress * progress * (3 - 2 * progress);
    camera.position.lerpVectors(move.position, move.endPosition, eased);
    target.lerpVectors(move.target, move.endTarget, eased);
    if (progress === 1) this.move = null;
    return true;
  }
}
