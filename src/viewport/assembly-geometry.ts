import type { PartGeometryData } from '../aether-core';

/** Definitions keep immutable geometry buffers. Names and placements belong to
 * occurrences; changing either does not invalidate their GPU resources. */
export function samePartGeometry(a: PartGeometryData, b: PartGeometryData): boolean {
  return a.sourceDocumentId === b.sourceDocumentId && a.geometryKind === b.geometryKind &&
    a.vertices === b.vertices && a.normals === b.normals && a.triangles === b.triangles &&
    a.edgeLines === b.edgeLines && a.topology === b.topology && a.faceRanges === b.faceRanges;
}
