import type { TopAbs_ShapeEnum } from "replicad-opencascadejs";
import { cast, getOC, measureArea, measureLength, type AnyShape, type Edge, type Face } from "replicad";
import { conicalSurfaceFrame } from "./conical-surface-frame";
import {
  connectorAxes,
  deleteAfterPointTuple,
  deleteAfterVectorTuple,
  pointAlongAxis,
  type ConnectorAxes,
} from "../geometry/index";
import type {
  ConnectorCandidate,
  FaceTopologyData,
  TopologyMeasurements,
  Vec3,
} from "../contracts/index";
import {
  connectorKindPreference,
  cylinderAxisStations,
  sameOrigin,
} from "../geometry/index";

function errorDescription(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "number") return `OCCT exception 0x${error.toString(16)}`;
  return String(error);
}

function addUniqueCandidate(
  candidates: ConnectorCandidate[],
  candidate: ConnectorCandidate,
): void {
  // One visible node represents one exact location. Analytic axis/center
  // candidates are inserted before coincident boundary descriptions.
  // Edges are curves, not nodes: every edge keeps its own candidate even when its
  // midpoint lands on another candidate's origin, or it could never be picked.
  const duplicateIndex = candidate.kind === "edge-midpoint" ? -1 : candidates.findIndex((existing) =>
    existing.kind !== "edge-midpoint" && sameOrigin(existing.origin, candidate.origin),
  );
  if (duplicateIndex < 0) {
    candidates.push(candidate);
  } else if (
    connectorKindPreference(candidate.kind) <
    connectorKindPreference(candidates[duplicateIndex].kind)
  ) {
    candidates[duplicateIndex] = candidate;
  }
}

function frameAtEdge(
  edge: Edge,
  position: number,
  fallback: ConnectorAxes,
): ConnectorAxes {
  try {
    return connectorAxes(
      fallback.zAxis,
      deleteAfterVectorTuple(edge.tangentAt(position)),
    );
  } catch {
    return fallback;
  }
}

function curveCandidates(
  faceId: number,
  edge: Edge,
  faceFrame: ConnectorAxes,
  edgeIndex: number,
): ConnectorCandidate[] {
  const oc = getOC();
  const candidates: ConnectorCandidate[] = [];
  // What Measure shows for the edge: length, and a circle's radius and centre
  // or a straight edge's direction. Shared by every candidate on the edge.
  const measurements: TopologyMeasurements = {};
  try { measurements.lengthMillimeters = measureLength(edge); } catch { /* unmeasurable curve */ }
  const adaptor = new oc.BRepAdaptor_Curve_2(edge.wrapped);
  try {
    if (adaptor.GetType() === oc.GeomAbs_CurveType.GeomAbs_Line) {
      try {
        const direction = deleteAfterVectorTuple(edge.tangentAt(0.5));
        const length = Math.hypot(...direction) || 1;
        measurements.linearDirection = [direction[0] / length, direction[1] / length, direction[2] / length];
      } catch { /* keep the length only */ }
    }
    if (adaptor.GetType() === oc.GeomAbs_CurveType.GeomAbs_Circle) {
      const circle = adaptor.Circle();
      const axis = circle.Axis();
      const position = circle.Position();
      try {
        measurements.radiusMillimeters = circle.Radius();
        measurements.centerMillimeters = deleteAfterPointTuple(circle.Location());
        { const d = axis.Direction(); measurements.axisDirection = [d.X(), d.Y(), d.Z()]; d.delete(); }
        candidates.push({
          id: `face-${faceId}-circle-${edgeIndex}`,
          faceId,
          kind: "circle-center",
          label: `Circular edge ${edgeIndex + 1} center`,
          measurements,
          origin: deleteAfterPointTuple(circle.Location()),
          ...connectorAxes(
            deleteAfterPointTuple(axis.Direction()),
            deleteAfterPointTuple(position.XDirection()),
          ),
        });
      } finally {
        axis.delete();
        position.delete();
        circle.delete();
      }
    } else if (adaptor.GetType() === oc.GeomAbs_CurveType.GeomAbs_Ellipse) {
      const ellipse = adaptor.Ellipse();
      const axis = ellipse.Axis();
      const position = ellipse.Position();
      try {
        candidates.push({
          id: `face-${faceId}-ellipse-${edgeIndex}`,
          faceId,
          kind: "ellipse-center",
          label: `Elliptical edge ${edgeIndex + 1} center`,
          origin: deleteAfterPointTuple(ellipse.Location()),
          ...connectorAxes(
            deleteAfterPointTuple(axis.Direction()),
            deleteAfterPointTuple(position.XDirection()),
          ),
        });
      } finally {
        axis.delete();
        position.delete();
        ellipse.delete();
      }
    }
  } catch {
    // An edge the analytic inspection cannot describe (a boolean's trimmed or
    // approximated curve) still has its sampled polyline and vertices below;
    // selection must reach every edge, measurements may be partial.
  } finally {
    adaptor.delete();
  }

  // The edge itself, sampled: two points for a line; a circular edge every 4° of its sweep
  // (a chord of a 100 mm circle then sits 0.06 mm off the arc); other curves 48 points.
  const samples = measurements.linearDirection ? 2
    : measurements.radiusMillimeters && measurements.lengthMillimeters
      ? Math.min(180, Math.max(12, Math.ceil(measurements.lengthMillimeters / measurements.radiusMillimeters / (4 * Math.PI / 180)) + 1))
      : 48;
  const polylineMillimeters = Array.from({ length: samples }, (_, i) => deleteAfterVectorTuple(edge.pointAt(i / (samples - 1)))).flatMap((p) => [p[0], p[1], p[2]]);
  if (polylineMillimeters.some((value) => !Number.isFinite(value))) {
    throw new Error(`face ${faceId} edge ${edgeIndex + 1}: the curve cannot be sampled`);
  }
  candidates.push({
    id: `face-${faceId}-edge-${edgeIndex}`,
    faceId,
    kind: "edge-midpoint",
    label: `Edge ${edgeIndex + 1} midpoint`,
    measurements,
    polylineMillimeters,
    origin: deleteAfterVectorTuple(edge.pointAt(0.5)),
    ...frameAtEdge(edge, 0.5, faceFrame),
  });
  candidates.push({
    id: `face-${faceId}-vertex-${edgeIndex}-a`,
    faceId,
    kind: "vertex",
    label: `Vertex ${edgeIndex + 1}A`,
    origin: deleteAfterVectorTuple(edge.startPoint),
    ...frameAtEdge(edge, 0, faceFrame),
  });
  candidates.push({
    id: `face-${faceId}-vertex-${edgeIndex}-b`,
    faceId,
    kind: "vertex",
    label: `Vertex ${edgeIndex + 1}B`,
    origin: deleteAfterVectorTuple(edge.endPoint),
    ...frameAtEdge(edge, 1, faceFrame),
  });
  return candidates;
}

function appendAxialStations(
  candidates: ConnectorCandidate[],
  faceId: number,
  kind: "cylinder-axis" | "cone-axis",
  axisOrigin: Vec3,
  axisDirection: Vec3,
  frame: ConnectorAxes,
  firstV: number,
  lastV: number,
  axialScale = 1,
): void {
  cylinderAxisStations(firstV, lastV).forEach((station) => {
    addUniqueCandidate(candidates, {
      id: `face-${faceId}-${kind}-${station.role}`,
      faceId,
      kind,
      label: `Exact ${kind === "cone-axis" ? "cone" : "cylinder"} axis ${station.role}`,
      origin: pointAlongAxis(
        axisOrigin,
        axisDirection,
        station.parameter * axialScale,
      ),
      ...frame,
    });
  });
}

function extractFaceTopology(face: Face, faceId: number): FaceTopologyData {
  const oc = getOC();
  let center: Vec3;
  try {
    center = deleteAfterVectorTuple(face.center);
  } catch (error) {
    throw new Error(`face ${faceId} center: ${errorDescription(error)}`);
  }

  let adaptor;
  try {
    adaptor = new oc.BRepAdaptor_Surface_2(face.wrapped, true);
  } catch (error) {
    throw new Error(`face ${faceId} adaptor: ${errorDescription(error)}`);
  }

  const candidates: ConnectorCandidate[] = [];
  // replicad spells cylinders in French; the product's references say CYLINDER.
  let surfaceType = face.geomType === "CYLINDRE" ? "CYLINDER" : face.geomType;
  let faceFrame = connectorAxes([0, 0, 1], [1, 0, 0]);
  const measurements: TopologyMeasurements = { centerMillimeters: center };
  try { measurements.areaSquareMillimeters = measureArea(face); } catch { /* unmeasurable surface */ }

  try {
    const type = adaptor.GetType();
    if (type === oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
      surfaceType = "PLANE";
      // The outward normal (the surface's own axis ignores the face orientation).
      try { measurements.planarNormal = deleteAfterVectorTuple(face.normalAt([center[0], center[1], center[2]])); } catch { /* keep the frame below */ }
      const plane = adaptor.Plane();
      const position = plane.Position();
      try {
        faceFrame = connectorAxes(
          measurements.planarNormal ?? deleteAfterPointTuple(position.Direction()),
          deleteAfterPointTuple(position.XDirection()),
        );
      } finally {
        position.delete();
        plane.delete();
      }
    } else if (type === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
      // Replicad intentionally keeps OCCT's historical French spelling.
      surfaceType = "CYLINDER";
      const cylinder = adaptor.Cylinder();
      measurements.radiusMillimeters = cylinder.Radius();
      const axis = cylinder.Axis();
      const position = cylinder.Position();
      try {
        const axisDirection = deleteAfterPointTuple(axis.Direction());
        faceFrame = connectorAxes(
          axisDirection,
          deleteAfterPointTuple(position.XDirection()),
        );
        appendAxialStations(
          candidates,
          faceId,
          "cylinder-axis",
          deleteAfterPointTuple(axis.Location()),
          axisDirection,
          faceFrame,
          adaptor.FirstVParameter(),
          adaptor.LastVParameter(),
        );
      } finally {
        position.delete();
        axis.delete();
        cylinder.delete();
      }
    } else if (type === oc.GeomAbs_SurfaceType.GeomAbs_Cone) {
      surfaceType = "CONE";
      const cone = conicalSurfaceFrame(adaptor);
      faceFrame = connectorAxes(cone.axis, cone.radial);
      appendAxialStations(candidates, faceId, "cone-axis", cone.origin,
        cone.axis, faceFrame, cone.firstV, cone.lastV, cone.axialScale);
    } else if (type === oc.GeomAbs_SurfaceType.GeomAbs_Sphere) {
      surfaceType = "SPHERE";
      const sphere = adaptor.Sphere();
      const position = sphere.Position();
      try {
        faceFrame = connectorAxes(
          deleteAfterPointTuple(position.Direction()),
          deleteAfterPointTuple(position.XDirection()),
        );
        addUniqueCandidate(candidates, {
          id: `face-${faceId}-sphere-center`,
          faceId,
          kind: "sphere-center",
          label: "Exact sphere center",
          origin: deleteAfterPointTuple(sphere.Location()),
          ...faceFrame,
        });
      } finally {
        position.delete();
        sphere.delete();
      }
    } else if (type === oc.GeomAbs_SurfaceType.GeomAbs_Torus) {
      surfaceType = "TORUS";
      const torus = adaptor.Torus();
      const position = torus.Position();
      try {
        faceFrame = connectorAxes(
          deleteAfterPointTuple(position.Direction()),
          deleteAfterPointTuple(position.XDirection()),
        );
        addUniqueCandidate(candidates, {
          id: `face-${faceId}-torus-center`,
          faceId,
          kind: "torus-center",
          label: "Exact torus center and revolution axis",
          origin: deleteAfterPointTuple(torus.Location()),
          ...faceFrame,
        });
      } finally {
        position.delete();
        torus.delete();
      }
    } else {
      try {
        faceFrame = connectorAxes(
          deleteAfterVectorTuple(
            face.normalAt([center[0], center[1], center[2]]),
          ),
          [1, 0, 0],
        );
      } catch {
        // Unsupported freeform surfaces remain renderable and keep their
        // edge/vertex inference even without a stable center normal.
      }
    }
  } catch {
    // Analytic inference is optional. An unavailable frame must not erase the
    // measured native face or its independently extractable boundary edges.
    // In particular gp_Cone/gp_Torus are absent from the compact WASM bindings.
    try { faceFrame = connectorAxes(deleteAfterVectorTuple(face.normalAt([...center])), [1, 0, 0]); }
    catch { /* retain the neutral frame; topology and measurements remain valid */ }
  } finally {
    adaptor.delete();
  }

  addUniqueCandidate(candidates, {
    id: `face-${faceId}-center`,
    faceId,
    kind: "face-center",
    label: `${surfaceType.toLowerCase()} face center`,
    origin: center,
    ...faceFrame,
  });

  face.edges.forEach((edge, edgeIndex) => {
    try {
      try {
        curveCandidates(faceId, edge, faceFrame, edgeIndex).forEach((candidate) =>
          addUniqueCandidate(candidates, candidate),
        );
      } catch {
        // One unsupported curve must not discard the face or Part.
      }
    } finally {
      edge.delete();
    }
  });

  return { id: faceId, surfaceType, measurements, candidates };
}

/** A face id from what the face is, not where it sits in memory: the same
 *  face gets the same id on every rebuild, so references and selections
 *  survive an edit that leaves it unchanged. Ids are unique within a shape. */
function signatureText(face: Face): string {
  let text = face.geomType;
  // One surface-properties pass gives both the centre and the area (two passes
  // were most of the cost of listing a body's faces).
  const oc = getOC();
  const properties = new oc.GProp_GProps_1();
  try {
    oc.BRepGProp.SurfaceProperties_1(face.wrapped, properties, false, false);
    const centre = properties.CentreOfMass();
    text += "|" + [centre.X(), centre.Y(), centre.Z()].map((v) => v.toFixed(3)).join(",") + "|" + properties.Mass().toFixed(3);
    centre.delete();
  } catch { /* keep the type */ } finally { properties.delete(); }
  return text;
}
function faceSignature(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  return (hash % 0x3ffffffe) + 1;
}
/** Topology of faces seen before, by their geometric signature: a face that an
 *  edit left unchanged (most faces of a part, through booleans) is measured
 *  once per session, not once per rebuild. Same geometry, same measurements. */
const topologyCache = new Map<string, FaceTopologyData>();
const TOPOLOGY_CACHE_LIMIT = 20000;

/** Every face of a shape with its stable id, in the kernel's face order. The
 *  caller deletes the faces. */
export function facesOf(shape: AnyShape): { face: Face; id: number; hash: number; key?: string }[] {
  const oc = getOC();
  const explorer = new oc.TopExp_Explorer_2(
    shape.wrapped,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as TopAbs_ShapeEnum,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as TopAbs_ShapeEnum,
  );
  const faces: { face: Face; id: number; hash: number; key?: string }[] = [];
  const hashes = new Set<number>();
  const ids = new Set<number>();
  try {
    for (; explorer.More(); explorer.Next()) {
      const current = explorer.Current();
      const hash = current.HashCode(2_147_483_647);
      if (hashes.has(hash)) continue;
      hashes.add(hash);
      const face = cast(oc.TopoDS.Face_1(current)) as Face;
      const key = signatureText(face);
      let id = faceSignature(key);
      while (ids.has(id)) id++;
      ids.add(id);
      faces.push({ face, id, hash, key });
    }
  } finally {
    explorer.delete();
  }
  return faces;
}

/** The topology of faces listed by `facesOf`; the faces are deleted. */
export function topologyOf(faces: { face: Face; id: number; key?: string }[]): FaceTopologyData[] {
  const topology: FaceTopologyData[] = [];
  for (const { face, id, key } of faces) {
    try {
      const cached = key !== undefined ? topologyCache.get(key) : undefined;
      if (cached) { topology.push({ ...cached, id }); continue; }
      let data: FaceTopologyData;
      try {
        data = extractFaceTopology(face, id);
      } catch {
        data = { id, surfaceType: "UNAVAILABLE", candidates: [] };
      }
      topology.push(data);
      if (key !== undefined && data.surfaceType !== "UNAVAILABLE") {
        if (topologyCache.size >= TOPOLOGY_CACHE_LIMIT) topologyCache.delete(topologyCache.keys().next().value as string);
        topologyCache.set(key, data);
      }
    } finally {
      face.delete();
    }
  }
  return topology;
}

export function extractExactTopology(shape: AnyShape): FaceTopologyData[] {
  return topologyOf(facesOf(shape));
}

