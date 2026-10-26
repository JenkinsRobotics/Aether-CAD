import { Raycaster, Vector2, Vector3, type Camera, type Group, type Mesh } from 'three/webgpu';
import { connectorKindPreference, type ConnectorCandidate, type FaceRangeData, type FaceTopologyData } from '../aether-core';
import type { CADSelectionItem, CADScreenPoint } from '../cad-selection-store';
import { faceIdForTriangle, projectScreenPoint } from './picking-math';

export interface AnchorPart {
  data: { id: string; name: string };
  group: Group;
  surface: Mesh;
  topology: Map<number, FaceTopologyData>;
  faceRanges: FaceRangeData[];
}
export interface AnchorFace { part: AnchorPart; faceId: number }
export interface TopologyAnchor extends AnchorFace { candidate: ConnectorCandidate }
export interface AnchorPick {
  face: AnchorFace | null;
  anchors: TopologyAnchor[];
  snapped: TopologyAnchor | null;
}
const EMPTY: AnchorPick = { face: null, anchors: [], snapped: null };
export const ANCHOR_SNAP_PIXELS = 14;
const internalKinds = new Set(['circle-center', 'ellipse-center', 'cylinder-axis', 'cone-axis', 'sphere-center', 'torus-center']);

export function anchorWorldPoint(anchor: TopologyAnchor): Vector3 {
  anchor.part.group.updateWorldMatrix(true, false);
  return new Vector3(...anchor.candidate.origin).applyMatrix4(anchor.part.group.matrixWorld);
}

// A shared corner is described by several faces. Its selection identity must
// stay the same when the pointer crosses the seam, while a mate retains the
// frame of the face the user actually chose.
const identities = new WeakMap<Map<number, FaceTopologyData>, Map<string, string>>();
const positionKey = (candidate: ConnectorCandidate) => candidate.origin.map(value => Math.round(value * 1e7)).join(',');
function canonicalCandidateId(anchor: TopologyAnchor): string {
  const topology = anchor.part.topology;
  let ids = identities.get(topology);
  if (!ids) {
    const candidates = [...topology.values()].flatMap(face => face.candidates).sort((a, b) =>
      connectorKindPreference(a.kind) - connectorKindPreference(b.kind) || a.id.localeCompare(b.id));
    ids = new Map();
    for (const candidate of candidates) if (!ids.has(positionKey(candidate))) ids.set(positionKey(candidate), candidate.id);
    identities.set(topology, ids);
  }
  return ids.get(positionKey(anchor.candidate)) ?? anchor.candidate.id;
}

export function anchorSelection(anchor: TopologyAnchor): CADSelectionItem {
  return {
    id: `anchor:${anchor.part.data.id}:${canonicalCandidateId(anchor)}`,
    kind: 'vertex', partId: anchor.part.data.id, faceId: anchor.faceId,
    label: anchor.candidate.label, detail: `Snap point · ${anchor.part.data.name}`,
  };
}

/** Exact topology only: never infer corners from tessellation triangles.
 * Both measurement and connector placement use this picking policy. */
export class TopologyAnchorPicker {
  private previous: AnchorFace | null = null;
  clear(): void { this.previous = null; }

  pick(parts: readonly AnchorPart[], camera: Camera, size: { width: number; height: number }, point: CADScreenPoint,
    hides: (partId: string, world: Vector3) => boolean = () => false): AnchorPick {
    const visible = parts.filter(part => part.group.visible && part.surface.visible);
    if (!visible.length) { this.clear(); return EMPTY; }
    visible.forEach(part => part.group.updateWorldMatrix(true, true));
    camera.updateMatrixWorld();
    const surfaces = visible.map(part => part.surface);
    const ray = new Raycaster();
    const cast = (screen: CADScreenPoint) => {
      ray.setFromCamera(new Vector2(screen.x / size.width * 2 - 1, 1 - screen.y / size.height * 2), camera);
      return ray.intersectObjects(surfaces, false).filter(hit => !hides(String(hit.object.userData.partId), hit.point));
    };
    const hit = cast(point)[0];
    const part = hit && visible.find(part => part.surface === hit.object);
    const faceId = part && hit.faceIndex != null ? faceIdForTriangle(part.faceRanges, hit.faceIndex) : undefined;
    const hovered = part && faceId !== undefined ? { part, faceId } : null;
    const previous = this.previous && visible.includes(this.previous.part) ? this.previous : null;
    const project = (world: Vector3) => projectScreenPoint(world, camera, size);
    const distance = (anchor: TopologyAnchor) => {
      const projected = project(anchorWorldPoint(anchor));
      return projected ? Math.hypot(projected.x - point.x, projected.y - point.y) : Infinity;
    };
    const exposed = (anchor: TopologyAnchor, allowInternal: boolean) => {
      const world = anchorWorldPoint(anchor), projected = project(world);
      if (!projected || hides(anchor.part.data.id, world)) return false;
      const occluder = cast(projected)[0];
      if (!occluder) return true; // Includes a silhouette corner outside the tessellation.
      const tolerance = Math.max(1e-5, world.distanceTo(ray.ray.origin) * 1e-6);
      if (occluder.distance >= world.distanceTo(ray.ray.origin) - tolerance) return true;
      // Shaft/circle centers lie within their own solid. Expose them only for
      // the face being inspected, never through a different component.
      return allowInternal && internalKinds.has(anchor.candidate.kind) && occluder.object === anchor.part.surface;
    };
    const onFace = (face: AnchorFace) => (face.part.topology.get(face.faceId)?.candidates ?? [])
      .map(candidate => ({ ...face, candidate }));
    let face = hovered ?? previous;
    let anchors = face ? onFace(face).filter(anchor => exposed(anchor, true)) : [];
    const nearest = (candidates: TopologyAnchor[]) => candidates.filter(anchor => distance(anchor) <= ANCHOR_SNAP_PIXELS)
      .sort((a, b) => distance(a) - distance(b) || connectorKindPreference(a.candidate.kind) - connectorKindPreference(b.candidate.kind))[0] ?? null;
    let snapped = nearest(anchors);
    if (!hovered && !snapped) {
      // First approach may land just outside a silhouette: a face hit is not
      // required to acquire a nearby visible corner or midpoint.
      const nearby = visible.flatMap(part => [...part.topology.values()].flatMap(topology =>
        topology.candidates.map(candidate => ({ part, faceId: topology.id, candidate }))))
        .filter(anchor => distance(anchor) <= ANCHOR_SNAP_PIXELS && exposed(anchor, false));
      snapped = nearest(nearby);
      face = snapped ? { part: snapped.part, faceId: snapped.faceId } : null;
      anchors = face ? onFace(face).filter(anchor => exposed(anchor, true)) : [];
    }
    this.previous = face;
    return { face, anchors, snapped };
  }
}
