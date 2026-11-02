import * as THREE from "three/webgpu";

/** The world-origin dot as geometry, not a masked point sprite (Jonathan, 2026-11-01: only
 *  inserted images are bitmaps). It faces the camera and keeps a fixed size in screen pixels. */
const PIXELS = 5;
export function createOriginMarker(): THREE.Mesh {
  const marker = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), new THREE.MeshBasicMaterial({
    color: 0x454b53, depthTest: false, depthWrite: false, toneMapped: false,
  }));
  marker.name = "Origin";
  marker.renderOrder = 25;
  marker.visible = false;
  return marker;
}

/** Per frame: face the camera and scale to PIXELS on screen at the marker's depth. */
export function updateOriginMarker(marker: THREE.Object3D, camera: THREE.Camera, viewportHeightPx: number): void {
  if (!marker.visible || !viewportHeightPx) return;
  marker.quaternion.copy(camera.quaternion);
  let worldPerPixel: number;
  if (camera instanceof THREE.PerspectiveCamera) {
    const distance = marker.getWorldPosition(new THREE.Vector3()).distanceTo(camera.position);
    worldPerPixel = (2 * distance * Math.tan((camera.fov * Math.PI) / 360)) / viewportHeightPx;
  } else if (camera instanceof THREE.OrthographicCamera) {
    worldPerPixel = (camera.top - camera.bottom) / camera.zoom / viewportHeightPx;
  } else return;
  marker.scale.setScalar(PIXELS * worldPerPixel);
}
