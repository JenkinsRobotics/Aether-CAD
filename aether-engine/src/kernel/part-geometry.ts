import { measureLength, type AnyShape } from "replicad";
import { deleteAfterVectorTuple } from "../geometry/frames";
import type { SolidVertexAnchor } from "../document/extrusion-point-reference";
import type { PartGeometryData } from "../contracts/index";
import { facesOf, topologyOf } from "./exact-topology";

function errorDescription(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "number") return `OCCT exception 0x${error.toString(16)}`;
  return String(error);
}

/** Creates the disposable render projection while retaining exact B-Rep topology. */
export function buildPartGeometry(
  shape: AnyShape,
  sourceDocumentId: string,
  sourceName: string,
  partIndex: number,
  options: { id?: string; name?: string; preview?: boolean } = {},
): PartGeometryData {
  let mesh;
  let edges;
  let topology;
  // replicad names mesh groups by the face's kernel hash; picks use the
  // topology's stable ids, so the groups are renamed through this map.
  const idByHash = new Map<number, number>();
  try {
    // Capture authoritative B-Rep topology before tessellation. Some generated
    // browser bindings invalidate analytic iterators after meshing curved solids.
    // A preview overlay is never picked, so it skips the topology entirely.
    const faces = options.preview ? [] : facesOf(shape);
    for (const face of faces) idByHash.set(face.hash, face.id);
    topology = topologyOf(faces);
  } catch (error) {
    throw new Error(
      `${sourceName} Part ${partIndex + 1} analytic topology: ${errorDescription(error)}`,
    );
  }
  // Display accuracy: never coarser than the 0.1 mm chord deflection the FreeCAD
  // worker used (its angular step was 0.25 rad; ours is 0.2), and finer than
  // that on small parts so a 10 mm pin is as smooth as a 600 mm wheel. A
  // preview overlay is transient and meshes three times coarser.
  const bounds = shape.boundingBox.bounds;
  const diagonal = Math.hypot(bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1], bounds[1][2] - bounds[0][2]);
  const tolerance = Math.min(options.preview ? 0.3 : 0.1, Math.max(0.01, diagonal * (options.preview ? 0.003 : 0.0012)));
  const angularTolerance = options.preview ? 0.35 : 0.2;
  // Vertex and straight-edge anchors (FreeCAD's checked references): each candidate
  // gets a fresh object, since face topology is cached by face signature across bodies.
  if (!options.preview) {
    const anchors = vertexAnchorsOf(shape);
    const keyOf = (p: readonly number[]) => p.map((v) => (Math.round(v * 1e7) / 1e7 + 0).toFixed(7)).join(",");
    topology = topology.map((face) => ({ ...face, candidates: face.candidates.map((candidate) => {
      if (candidate.kind === "vertex") { const anchor = anchors.get(keyOf(candidate.origin)); return anchor ? { ...candidate, vertexAnchor: anchor } : candidate; }
      if (candidate.kind === "edge-midpoint" && candidate.measurements?.linearDirection && candidate.measurements.lengthMillimeters) {
        const d = candidate.measurements.linearDirection, h = candidate.measurements.lengthMillimeters / 2, o = candidate.origin;
        const start = anchors.get(keyOf([o[0] - d[0] * h, o[1] - d[1] * h, o[2] - d[2] * h])), end = anchors.get(keyOf([o[0] + d[0] * h, o[1] + d[1] * h, o[2] + d[2] * h]));
        if (start && end && keyOf(start.positionMillimeters) !== keyOf(end.positionMillimeters)) return { ...candidate, edgeAnchor: { start, end } };
      }
      return candidate;
    }) }));
  }
  try {
    mesh = shape.mesh({ tolerance, angularTolerance });
  } catch (error) {
    throw new Error(
      `${sourceName} Part ${partIndex + 1} surface tessellation: ${errorDescription(error)}`,
    );
  }
  try {
    edges = shape.meshEdges({ tolerance, angularTolerance });
  } catch (error) {
    throw new Error(
      `${sourceName} Part ${partIndex + 1} edge tessellation: ${errorDescription(error)}`,
    );
  }
  const stem = sourceName.replace(/\.(step|stp|aethercad)$/i, "");
  return {
    id: options.id ?? `${sourceDocumentId}:body-${partIndex + 1}`,
    name: options.name ?? `${stem} · Part ${partIndex + 1}`,
    sourceDocumentId,
    sourceName,
    vertices: new Float32Array(mesh.vertices),
    normals: new Float32Array(mesh.normals),
    triangles: new Uint32Array(mesh.triangles),
    edgeLines: new Float32Array(edges.lines),
    // replicad numbers mesh groups by face order; the viewer picks by the
    // topology's stable ids, so the groups are renamed to them.
    faceRanges: mesh.faceGroups.map((group) => ({ ...group, faceId: idByHash.get(group.faceId) ?? group.faceId })),
    topology,
  };
}

/** Eight seeded FNV-1a lanes over a string, as 64 hex digits (the width documents
 *  validate a shape fingerprint to; a signature uses the same text). */
function hashText(text: string): string {
  const lanes = [2166136261, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5];
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); for (let k = 0; k < lanes.length; k++) lanes[k] = Math.imul(lanes[k] ^ c ^ (k * 131), 16777619) >>> 0; }
  return lanes.map((v) => v.toString(16).padStart(8, "0")).join("");
}

/** Every vertex of a solid with a checked anchor (FreeCAD's vertex_reference): its
 *  position, a signature of what meets there (face and edge kinds, within the shape's
 *  structure), its incidence and the shape's fingerprint. References resolve by
 *  position; the rest lets a document refuse a reference whose source changed. */
export function vertexAnchorsOf(shape: AnyShape): Map<string, SolidVertexAnchor> {
  const keyOf = (p: readonly number[]) => p.map((v) => (Math.round(v * 1e7) / 1e7 + 0).toFixed(7)).join(",");
  const records = new Map<string, { point: [number, number, number]; faces: string[]; edges: string[]; faceIndices: number[]; edgeIndices: number[] }>();
  const record = (p: readonly number[]) => { const key = keyOf(p); let r = records.get(key); if (!r) { r = { point: [p[0], p[1], p[2]], faces: [], edges: [], faceIndices: [], edgeIndices: [] }; records.set(key, r); } return r; };
  const faces = shape.faces, edges = shape.edges;
  const faceKinds: string[] = [], edgeSummaries: string[] = [];
  try {
    faces.forEach((face, faceIndex) => {
      const kind = face.geomType; faceKinds.push(kind);
      const seen = new Set<string>();
      const faceEdges = face.edges;
      for (const edge of faceEdges) {
        for (const p of [deleteAfterVectorTuple(edge.startPoint), deleteAfterVectorTuple(edge.endPoint)]) {
          const key = keyOf(p); if (seen.has(key)) continue; seen.add(key);
          // The face's outward normal at the vertex tells a box's corners apart (FreeCAD's signature).
          let normal: number[] | null = null;
          try { normal = [...deleteAfterVectorTuple(face.normalAt([p[0], p[1], p[2]]))].map((v: number) => +v.toFixed(7) + 0); } catch { /* pole or seam: kind only */ }
          const r = record(p); r.faces.push(JSON.stringify([kind, normal])); r.faceIndices.push(faceIndex);
        }
        edge.delete();
      }
    });
    edges.forEach((edge, edgeIndex) => {
      const kind = edge.geomType; let length = 0; try { length = measureLength(edge); } catch { /* degenerate */ }
      const mid = deleteAfterVectorTuple(edge.pointAt(0.5));
      edgeSummaries.push(JSON.stringify([kind, +length.toFixed(7), [...mid].map((v: number) => +v.toFixed(7))]));
      const seen = new Set<string>();
      for (const p of [deleteAfterVectorTuple(edge.startPoint), deleteAfterVectorTuple(edge.endPoint)]) {
        const key = keyOf(p); if (seen.has(key)) continue; seen.add(key);
        const r = record(p); r.edges.push(kind); r.edgeIndices.push(edgeIndex);
      }
    });
  } finally { faces.forEach((f) => f.delete()); edges.forEach((e) => e.delete()); }
  const counts = [...faceKinds.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())].sort();
  const structure = JSON.stringify([counts, edgeSummaries.length, records.size]);
  const fingerprint = hashText(JSON.stringify([[...records.keys()].sort(), faceKinds.slice().sort(), edgeSummaries.slice().sort()]));
  const anchors = new Map<string, SolidVertexAnchor>();
  for (const [key, r] of records) anchors.set(key, { positionMillimeters: r.point, shapeFingerprint: fingerprint, incidence: JSON.stringify([r.faceIndices, r.edgeIndices]), signature: hashText(JSON.stringify([structure, r.faces.slice().sort(), r.edges.slice().sort()])) });
  return anchors;
}
