import type { CADSelectionItem } from "../cad-selection-store";
import { selectedCandidateId } from "../viewport/topology-selection";

/** The engine's name for a selected face, edge or vertex: the body, the face's
 *  stable id, and the edge's index on that face (topology.py numbering). */
export interface MeasureReference { body_id: string; face_id?: number; edge_index?: number; vertex?: "a" | "b" }

export function measureReference(item: CADSelectionItem): MeasureReference | null {
  if (item.kind === "body") return { body_id: item.partId };
  if (item.kind === "face") return item.faceId === undefined ? null : { body_id: item.partId, face_id: item.faceId };
  const candidate = selectedCandidateId(item) ?? "";
  const edge = /^face-(-?\d+)-(?:edge|circle|ellipse)-(\d+)$/.exec(candidate);
  if (edge) return { body_id: item.partId, face_id: Number(edge[1]), edge_index: Number(edge[2]) };
  const vertex = /^face-(-?\d+)-vertex-(\d+)-([ab])$/.exec(candidate);
  if (vertex) return { body_id: item.partId, face_id: Number(vertex[1]), edge_index: Number(vertex[2]), vertex: vertex[3] as "a" | "b" };
  return null;
}
