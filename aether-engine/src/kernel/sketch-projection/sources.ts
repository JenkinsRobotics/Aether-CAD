import type { AnyShape, Edge, Shape3D } from "replicad";
import type { MeasureEntity } from "../../contracts/geometry";
import { facesOf } from "../exact-topology";

export interface ProjectionSource { entity: MeasureEntity; edge: Edge }

/** Resolve every requested entity before producing geometry. An invalid source
 * must not quietly broaden selection to the entire body. Wrappers are borrowed
 * by the callback and always disposed together, even when conversion fails. */
export function withProjectionSources<T>(
  bodies: ReadonlyMap<string, Shape3D>,
  entities: MeasureEntity[] | undefined,
  run: (sources: ProjectionSource[]) => T,
): T {
  const owned: AnyShape[] = [];
  const sources: ProjectionSource[] = [];
  const requested: MeasureEntity[] = entities ?? [...bodies.keys()].map(body_id => ({ body_id }));
  const seenEdges: Edge[] = [];
  const faceCache = new Map<string, ReturnType<typeof facesOf>>();
  const edgeCache = new Map<AnyShape, Edge[]>();
  const add = (entity: MeasureEntity, edge: Edge) => {
    if (entity.vertex === undefined) {
      if (seenEdges.some(previous => previous.isSame(edge))) return;
      seenEdges.push(edge);
    }
    sources.push({ entity, edge });
    if (sources.length > 4096) throw Error("Project at most 4096 source edges at once; choose specific faces or edges.");
  };
  try {
    for (const entity of requested) {
      const body = bodies.get(entity.body_id);
      if (!body) throw Error(`Projection body ${entity.body_id} no longer exists or is not an exact body.`);
      let faces = faceCache.get(entity.body_id);
      if (!faces) {
        faces = facesOf(body);
        owned.push(...faces.map(item => item.face));
        faceCache.set(entity.body_id, faces);
      }
      const selected = entity.face_id === undefined ? faces : faces.filter(item => item.id === entity.face_id);
      if (!selected.length) throw Error(`Projection face ${entity.face_id} no longer exists on ${entity.body_id}.`);
      for (const { face, id } of selected) {
        let edges = edgeCache.get(face);
        if (!edges) {
          edges = face.edges;
          owned.push(...edges);
          edgeCache.set(face, edges);
        }
        if (entity.edge_index !== undefined) {
          const edge = edges[entity.edge_index];
          if (!edge) throw Error(`Projection edge ${entity.edge_index} no longer exists on face ${id}.`);
          add(entity, edge);
        } else edges.forEach((edge, edge_index) => add({ body_id: entity.body_id, face_id: id, edge_index }, edge));
      }
    }
    if (!sources.length) throw Error("The selected model contains no exact edges to project.");
    return run(sources);
  } finally { owned.reverse().forEach(shape => shape.delete()); }
}
