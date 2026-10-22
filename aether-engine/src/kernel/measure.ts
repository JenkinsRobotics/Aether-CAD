import { cast, DistanceQuery, type AnyShape, type Edge, type Face, type Shape3D, getOC } from "replicad";
import type { DistanceMeasurement, MeasureEntity, Vec3 } from "../contracts/index";
import type { PartDocument } from "../document/index";
import { facesOf } from "./exact-topology";
import { evaluatePartDocument } from "./part-evaluator";

const MISSING = "Select entities on solid bodies in this Part.";

/** The sub-shape an entity names, resolved on the evaluated bodies. */
function subShape(bodies: ReadonlyMap<string, Shape3D>, entity: MeasureEntity, own: (shape: AnyShape) => AnyShape): AnyShape {
  const body = bodies.get(entity.body_id);
  if (!body) throw new Error(MISSING);
  if (entity.face_id === undefined) return body;
  let face: Face | undefined;
  for (const item of facesOf(body)) { if (item.id === entity.face_id && !face) face = item.face; else item.face.delete(); }
  if (!face) throw new Error(MISSING);
  own(face);
  if (entity.edge_index === undefined) return face;
  const edges = face.edges;
  const edge: Edge | undefined = edges[entity.edge_index];
  edges.forEach((item, index) => { if (index !== entity.edge_index) item.delete(); });
  if (!edge) throw new Error(MISSING);
  own(edge);
  if (!entity.vertex) return edge;
  const point = entity.vertex === "a" ? edge.startPoint : edge.endPoint;
  const oc = getOC();
  const maker = new oc.BRepBuilderAPI_MakeVertex(new oc.gp_Pnt_3(point.x, point.y, point.z));
  try { return own(cast(maker.Vertex())); } finally { maker.delete(); point.delete(); }
}

/** Exact minimum distance between two entities of the document's bodies. */
export function measureDistance(document: PartDocument, entities: readonly MeasureEntity[]): DistanceMeasurement {
  if (entities.length !== 2) throw new Error("Select two entities to measure between.");
  let measurement: DistanceMeasurement | undefined;
  evaluatePartDocument(document, { withBodies: (bodies) => {
    const owned: AnyShape[] = [];
    const own = (shape: AnyShape) => { owned.push(shape); return shape; };
    try {
      const [a, b] = entities.map((entity) => subShape(bodies, entity, own));
      const query = new DistanceQuery(a);
      try {
        const distance = query.distanceTo(b);
        const raw = query.wrapped as unknown as { PointOnShape1(n: number): { X(): number; Y(): number; Z(): number; delete(): void }; PointOnShape2(n: number): { X(): number; Y(): number; Z(): number; delete(): void } };
        const p1 = raw.PointOnShape1(1), p2 = raw.PointOnShape2(1);
        const points: [Vec3, Vec3] = [[p1.X(), p1.Y(), p1.Z()], [p2.X(), p2.Y(), p2.Z()]];
        p1.delete(); p2.delete();
        measurement = { distance_mm: distance, points };
      } finally { query.delete(); }
    } finally { for (const shape of owned.reverse()) { try { shape.delete(); } catch { /* owned by a parent */ } } }
  } });
  if (!measurement) throw new Error(MISSING);
  return measurement;
}
