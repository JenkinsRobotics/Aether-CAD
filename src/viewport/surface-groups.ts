import type { BufferGeometry } from 'three/webgpu';
import type { FaceRangeData } from '../aether-core';

/** Face topology remains separate from GPU draw groups. Adjacent faces with
 * identical appearance need one draw, while picks still use original ranges. */
export function setSurfaceGroups(geometry: BufferGeometry, faces: readonly FaceRangeData[],
  material: (faceId: number | undefined) => number): void {
  const groups: { start: number; count: number; materialIndex: number }[] = [];
  for (const face of faces.length ? faces : [{ start: 0, count: geometry.index?.count ?? 0, faceId: undefined }]) {
    const materialIndex = material(face.faceId), previous = groups[groups.length - 1];
    if (previous && previous.materialIndex === materialIndex && previous.start + previous.count === face.start) {
      previous.count += face.count;
    } else groups.push({ start: face.start, count: face.count, materialIndex });
  }
  if (geometry.groups.length === groups.length && groups.every((group, i) => {
    const old = geometry.groups[i];
    return old.start === group.start && old.count === group.count && old.materialIndex === group.materialIndex;
  })) return;
  geometry.clearGroups();
  for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex);
}

export function paintSurfaceFace(geometry: BufferGeometry, faces: readonly FaceRangeData[], id: number, materialIndex: number): void {
  const old = geometry.groups.slice();
  const materials = new Map(faces.map(face => [face.faceId,
    old.find(group => face.start >= group.start && face.start < group.start + group.count)?.materialIndex ?? 0]));
  setSurfaceGroups(geometry, faces, faceId => faceId === id ? materialIndex : materials.get(faceId!) ?? 0);
}
