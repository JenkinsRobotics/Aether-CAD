import { Line2NodeMaterial } from 'three/webgpu';
import { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

/** Mesh-backed pixel-width lines work on WebGPU and its WebGL fallback. Native
 * line primitives silently ignore linewidth on many browsers. */
export function styledLines(positions: Float32Array | number[], color: number, width = 1, opacity = 1): LineSegments2 {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions.length ? positions : [0,0,0,0,0,0]);
  if (!positions.length) geometry.instanceCount = 0;
  const material = new Line2NodeMaterial({ color, linewidth: width, worldUnits: false, transparent: true, opacity, depthWrite: false, toneMapped: false, alphaToCoverage: true });
  const lines = new LineSegments2(geometry, material);
  // Opaque CAD faces must fill depth before non-depth-writing edge strokes.
  // Otherwise opaque (100% / hidden-line) strokes can sort before the faces
  // and be painted over, leaving only the outer silhouette.
  lines.renderOrder = 1;
  return lines;
}
