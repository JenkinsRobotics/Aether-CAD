import * as THREE from "three/webgpu";
import { vec3 } from "three/tsl";

/** Flat world-origin dot, sized in screen pixels so zoom never turns it into a ball. */
export function createOriginMarker(): THREE.Sprite {
  const size = 16;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      pixels.set([255, 255, 255, Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) <= size / 2 ? 255 : 0], index);
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.needsUpdate = true;
  // WebGPU point primitives are limited to one pixel. A point sprite honors
  // the pixel size and supplies UVs for the round mask.
  const marker = new THREE.Sprite(new THREE.PointsNodeMaterial({
    positionNode: vec3(0),
    color: 0x454b53,
    size: 5,
    sizeAttenuation: false,
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  }));
  marker.name = "Origin";
  marker.renderOrder = 25;
  marker.visible = false;
  return marker;
}
