/** The geometry behind picking: screen projection, face lookup, bounds.
 *
 *  These were private methods on `MateViewport`, which meant the arithmetic
 *  that decides *which face you clicked* could only run with a live WebGPU
 *  renderer attached — so none of it was under test. Nothing here touches the
 *  scene, so all of it is.
 */
import * as THREE from "three/webgpu";
import type { CADScreenRect } from "../cad-selection-store";
import type { FaceRangeData, PartGeometryData } from "../aether-core";

/** Where a world point lands on the canvas, or null when it is behind the
 *  camera or beyond the far plane. */
export function projectScreenPoint(
  world: THREE.Vector3,
  camera: THREE.Camera,
  canvas: { width: number; height: number },
): { x: number; y: number } | null {
  const projected = world.clone().project(camera);
  if (projected.z < -1 || projected.z > 1) return null;
  return {
    x: (projected.x + 1) * 0.5 * canvas.width,
    y: (1 - projected.y) * 0.5 * canvas.height,
  };
}

/** The axis-aligned screen box around a set of points, or null for none. */
export function screenRectForPoints(
  points: readonly { x: number; y: number }[],
): CADScreenRect | null {
  if (points.length === 0) return null;
  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

/** Which face a hit triangle belongs to.
 *
 *  Tessellation is per face and the ranges are index offsets, so the triangle
 *  index has to be multiplied out before it can be compared against them —
 *  the off-by-three that would otherwise pick a neighbouring face.
 */
export function faceIdForTriangle(
  ranges: readonly FaceRangeData[],
  triangleIndex: number,
): number | undefined {
  const indexOffset = triangleIndex * 3;
  return ranges.find(
    (range) => indexOffset >= range.start && indexOffset < range.start + range.count,
  )?.faceId;
}

/** The screen box a face covers, for box selection. */
export function projectedFaceBounds(
  geometry: THREE.BufferGeometry,
  matrixWorld: THREE.Matrix4,
  range: FaceRangeData,
  project: (world: THREE.Vector3) => { x: number; y: number } | null,
): CADScreenRect | null {
  const index = geometry.index;
  const positions = geometry.getAttribute("position");
  if (!index || !positions) return null;
  const points: Array<{ x: number; y: number }> = [];
  const end = Math.min(range.start + range.count, index.count);
  for (let offset = range.start; offset < end; offset += 1) {
    const local = new THREE.Vector3().fromBufferAttribute(positions, index.getX(offset));
    const projected = project(local.applyMatrix4(matrixWorld));
    if (projected) points.push(projected);
  }
  return screenRectForPoints(points);
}

/** The bounding box of a part's own vertices, before it is placed. */
export function localBounds(data: PartGeometryData): THREE.Box3 {
  const bounds = new THREE.Box3();
  for (let index = 0; index < data.vertices.length; index += 3) {
    bounds.expandByPoint(
      new THREE.Vector3(
        data.vertices[index],
        data.vertices[index + 1],
        data.vertices[index + 2],
      ),
    );
  }
  return bounds;
}

/** A stable key for a hover target, so re-hovering the same thing is a no-op.
 *
 *  Structurally typed rather than importing the viewer's union, which would
 *  make this module depend on the file it was extracted from.
 */
export function hoverKey(
  target:
    | { kind: "candidate"; part: { data: { id: string } }; candidate: { id: string } }
    | { kind: "connector"; connector: { id: string } }
    | null,
): string {
  if (!target) return "";
  return target.kind === "candidate"
    ? `candidate:${target.part.data.id}:${target.candidate.id}`
    : `connector:${target.connector.id}`;
}
