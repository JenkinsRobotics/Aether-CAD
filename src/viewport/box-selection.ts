/** What a drag-rectangle selects.
 *
 *  Dragging right is a Window (the whole thing must be inside); dragging left
 *  is a Crossing (touching is enough). Which items that yields depends on the
 *  selection filter — a Body, a face, an edge midpoint, a vertex — and on where
 *  each of those projects on screen.
 *
 *  Lifted out of the viewport class so it can be exercised with plain data:
 *  the only thing it needed a renderer for was projecting points, which is now
 *  a function the caller supplies.
 */
import * as THREE from "three/webgpu";
import {
  selectionRectangleMatches,
  type CADBoxSelectionMode,
  type CADScreenRect,
  type CADSelectionItem,
  type CADSelectionKind,
} from "../cad-selection-store";
import type { FaceRangeData, FaceTopologyData, PartGeometryData } from "../aether-core";
import { projectedFaceBounds, screenRectForPoints } from "./picking-math";

/** The part shape this needs, structurally, so the viewport keeps owning the
 *  real one and this module does not import the file it came out of. */
export interface SelectablePart {
  data: Pick<PartGeometryData, "id" | "name" | "geometryKind">;
  group: { visible: boolean; matrixWorld: THREE.Matrix4 };
  surface: THREE.Object3D & { geometry: THREE.BufferGeometry };
  topology: Map<number, FaceTopologyData>;
  faceRanges: FaceRangeData[];
}

export type ScreenProjector = (world: THREE.Vector3) => { x: number; y: number } | null;

/** The eight corners of a box, which is what a Body's screen extent is
 *  measured from — projecting only min and max would miss the other six. */
function boxCorners(bounds: THREE.Box3): THREE.Vector3[] {
  const corners: THREE.Vector3[] = [];
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z])
        corners.push(new THREE.Vector3(x, y, z));
  return corners;
}

export function itemsInsideSelectionBox(
  parts: Iterable<SelectablePart>,
  kind: CADSelectionKind,
  mode: CADBoxSelectionMode,
  selection: CADScreenRect,
  project: ScreenProjector,
): readonly CADSelectionItem[] {
  const items: CADSelectionItem[] = [];
  const containsPoint = (x: number, y: number): boolean =>
    x >= selection.left && x <= selection.right && y >= selection.top && y <= selection.bottom;

  for (const part of parts) {
    if (!part.group.visible) continue;

    if (kind === "component" || kind === "body") {
      const bounds = new THREE.Box3().setFromObject(part.surface, true);
      const points = boxCorners(bounds)
        .map(project)
        .filter((point): point is { x: number; y: number } => point !== null);
      const screenBounds = screenRectForPoints(points);
      if (screenBounds && selectionRectangleMatches(mode, selection, screenBounds))
        items.push({
          id: `${kind}:${part.data.id}`,
          kind,
          partId: part.data.id,
          label: part.data.name,
          detail: kind === "component" ? "Component occurrence" : part.data.geometryKind === "mesh" ? "Mesh reference" : "Exact Body",
        });
      continue;
    }

    if (kind === "face") {
      for (const [ordinal, range] of part.faceRanges.entries()) {
        const screenBounds = projectedFaceBounds(
          part.surface.geometry, part.group.matrixWorld, range, project,
        );
        const topology = part.topology.get(range.faceId);
        if (!screenBounds || !topology) continue;
        if (!selectionRectangleMatches(mode, selection, screenBounds)) continue;
        items.push({
          id: `face:${part.data.id}:${range.faceId}`,
          kind: "face",
          partId: part.data.id,
          faceId: range.faceId,
          // The id is a hash; the ordinal is what a reader can use.
          label: `Face ${ordinal + 1} of ${part.data.name}`,
          detail: topology.surfaceType,
        });
      }
      continue;
    }

    // Edges and vertices are single points, so they are in or out — a
    // Window/Crossing distinction means nothing for something with no extent.
    const candidateKind = kind === "edge" ? "edge-midpoint" : "vertex";
    part.topology.forEach((face) => {
      for (const candidate of face.candidates) {
        if (candidate.kind !== candidateKind) continue;
        const projected = project(
          new THREE.Vector3(...candidate.origin).applyMatrix4(part.group.matrixWorld),
        );
        if (!projected || !containsPoint(projected.x, projected.y)) continue;
        items.push({
          id: `${kind}:${part.data.id}:${candidate.id}`,
          kind,
          partId: part.data.id,
          faceId: face.id,
          label: candidate.label,
          detail: kind === "edge" ? "Exact edge" : "Exact vertex",
        });
      }
    });
  }
  // The same face can be reached twice through overlapping ranges.
  return [...new Map(items.map((item) => [item.id, item] as const)).values()];
}
