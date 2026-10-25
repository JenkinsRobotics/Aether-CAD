import { FaceFinder, Plane, type Face, type Shape3D, type EdgeFinder, type RadiusConfig, type FilletRadius, type ChamferRadius } from "replicad";
import type { PartFeature } from "../../document/index";
import type { PreviewHandle } from "../../contracts/geometry";
import { deleteAfterVectorTuple } from "../../geometry/index";
import { vertexAnchorsOf } from "../part-geometry";
import { add, scale, norm, unit, dot, type V3 } from "../vector";
type EdgeFinishFeature = Extract<PartFeature, {
  type: "fillet" | "chamfer";
}>;
type FaceReference = NonNullable<Extract<PartFeature, {
  type: "chamfer";
}>["referenceFace"]>;
export interface EdgeFinishContext {
  own: <T>(value: T) => T;
  previewId?: string;
  publish: (feature: {
    id: string;
  }, handle: PreviewHandle) => void;
  faceByReference: (body: Shape3D, reference: FaceReference, label: string) => Face;
}
/** Produces one exact finish. The caller owns the returned shape and retains
 * the source body. Temporary planes are retained by the evaluation step. */
export function buildEdgeFinish(feature: EdgeFinishFeature, bodyId: string, body: Shape3D, context: EdgeFinishContext): Shape3D {
  const { own, previewId, publish, faceByReference } = context;
  // An edge plane pins one world coordinate to the offset (FreeCAD's
  // `_edges_in_plane`: XY pins z, XZ pins y, YZ pins x), which saved documents
  // rely on; replicad's named XZ plane would pin y to the opposite sign.
  const edgePlane = feature.edgePlane ? (() => {
    const axis = ({ XY: [0, 0, 1], XZ: [0, 1, 0], YZ: [1, 0, 0] } as Record<string, V3>)[feature.edgePlane.plane];
    const xDirection = ({ XY: [1, 0, 0], XZ: [1, 0, 0], YZ: [0, 1, 0] } as Record<string, V3>)[feature.edgePlane.plane];
    if (!axis)
      throw new Error(`Unknown edge plane ${feature.edgePlane.plane}.`);
    return own(new Plane(scale(axis, feature.edgePlane.offsetMillimeters), xDirection, axis));
  })() : undefined;
  // Picked edges replace the plane pin: each is found again on the body it was
  // picked on (a straight edge by its vertex anchors, any edge by midpoint and
  // length) and the finish runs on exactly those edges, never the nearest.
  const pickedPoints = feature.edges?.map((pick): V3 => {
    if (pick.bodyId !== bodyId)
      throw new Error(`${pick.label} is on another body. Reselect edges on the target body.`);
    const refuse = () => new Error(`${pick.label} changed or is missing. Reselect the edges to finish.`);
    if (pick.kind === "solid-edge") {
      const anchors = [...vertexAnchorsOf(body).values()];
      const vertex = (anchor: typeof pick.anchor.start): V3 => {
        const matches = anchors.filter((a) => a.signature === anchor.signature);
        const found = matches.length === 1 ? matches[0] : matches.find((a) => a.shapeFingerprint === anchor.shapeFingerprint && Math.hypot(...a.positionMillimeters.map((v, i) => v - anchor.positionMillimeters[i])) < 1e-6);
        if (!found)
          throw refuse();
        return [...found.positionMillimeters] as V3;
      };
      const a = vertex(pick.anchor.start), b = vertex(pick.anchor.end);
      return scale(add(a, b), 0.5);
    }
    const target = pick.midpointMillimeters as V3, tolerance = Math.max(1e-3, pick.lengthMillimeters * 1e-6);
    const edges = body.edges;
    try {
      const hit = edges.find((edge) => {
        const m = edge.pointAt(0.5), d = Math.hypot(m.x - target[0], m.y - target[1], m.z - target[2]);
        m.delete();
        return d < 1e-3 && Math.abs(edge.length - pick.lengthMillimeters) <= tolerance;
      });
      if (!hit)
        throw refuse();
      const m = hit.pointAt(0.5);
      const point: V3 = [m.x, m.y, m.z];
      m.delete();
      return point;
    }
    finally {
      edges.forEach((edge) => edge.delete());
    }
  });
  const chainPoints = pickedPoints && feature.tangentChain ? tangentChainMidpoints(body, pickedPoints) : pickedPoints;
  if (feature.id === previewId) {
    // The size handle sits on the first finished edge and pulls into the part.
    const seed = chainPoints?.[0] ?? (() => {
      const edges = body.edges;
      const m = edges[0]?.pointAt(0.5);
      const p: V3 | undefined = m ? [m.x, m.y, m.z] : undefined;
      m?.delete();
      edges.forEach((edge) => edge.delete());
      return p;
    })();
    if (seed) {
      const faces = new FaceFinder().containsPoint(seed).find(body);
      const inward = faces.reduce<V3>((sum, f) => {
        const nv = f.normalAt(seed);
        const r: V3 = [sum[0] - nv.x, sum[1] - nv.y, sum[2] - nv.z];
        nv.delete();
        return r;
      }, [0, 0, 0]);
      faces.forEach((f) => f.delete());
      publish(feature, { parameter: "radius", kind: "linear", originMillimeters: seed, direction: norm(inward) > 1e-9 ? unit(inward) : [0, 0, -1], label: feature.type === "fillet" ? "Fillet radius" : "Chamfer size" });
    }
  }
  const filter = chainPoints ? (edges: EdgeFinder) => edges.either(chainPoints.map((p) => (f: EdgeFinder) => f.containsPoint(p)))
    : edgePlane ? (edges: EdgeFinder) => edges.inPlane(edgePlane) : undefined;
  const near = (p: V3, q: {
    x: number;
    y: number;
    z: number;
  }) => Math.hypot(p[0] - q.x, p[1] - q.y, p[2] - q.z) < 1e-3;
  // Per-edge sizes (a pick's own radius) and a variable fillet (size → end size).
  const size = feature.radiusMillimeters;
  const filletRadius = (): RadiusConfig<FilletRadius> => {
    const end = feature.type === "fillet" ? feature.endRadiusMillimeters : undefined;
    const perEdge = pickedPoints && feature.edges!.some((pick) => pick.radiusMillimeters !== undefined);
    if (!perEdge)
      return end !== undefined ? [size, end] : size;
    return (edge) => {
      const m = edge.pointAt(0.5);
      const i = pickedPoints!.findIndex((p) => near(p, m));
      const inChain = chainPoints!.some((p) => near(p, m));
      m.delete();
      return i >= 0 ? (feature.edges![i].radiusMillimeters ?? size) : inChain ? size : null;
    };
  };
  // An asymmetric chamfer needs the face its first leg lies on: the picked
  // reference face, else the adjacent face facing up most (SolidCraft's default).
  const chamferRadius = (): RadiusConfig<ChamferRadius> => {
    if (feature.type !== "chamfer" || (feature.secondDistanceMillimeters === undefined && feature.angleDegrees === undefined))
      return size;
    let reference: Face;
    if (feature.referenceFace)
      reference = faceByReference(body, feature.referenceFace, "Chamfer reference face");
    else {
      const point = pickedPoints?.[0];
      if (!point)
        throw new Error("An asymmetric chamfer needs picked edges or a reference face.");
      const adjacent = body.faces.filter((face) => {
        const edges = face.edges;
        const hit = edges.some((edge) => {
          const m = edge.pointAt(0.5);
          const h = near(point, m);
          m.delete();
          return h;
        });
        edges.forEach((edge) => edge.delete());
        return hit;
      });
      if (!adjacent.length)
        throw new Error("Chamfer reference face could not be found. Pick the reference face.");
      const up = (face: Face) => {
        const center = deleteAfterVectorTuple(face.center);
        return deleteAfterVectorTuple(face.normalAt([center[0], center[1], center[2]]))[2];
      };
      reference = adjacent.sort((a, b) => up(b) - up(a))[0];
      adjacent.slice(1).forEach((face) => face.delete());
    }
    const selectedFace = (f: FaceFinder) => f.inList([reference]);
    return feature.angleDegrees !== undefined ? { distance: size, angle: feature.angleDegrees, selectedFace } : { distances: [size, feature.secondDistanceMillimeters!], selectedFace };
  };
  let rounded: Shape3D;
  try {
    rounded = feature.type === "fillet" ? body.fillet(filletRadius(), filter) : body.chamfer(chamferRadius(), filter);
  }
  catch (error) {
    throw new Error(`${feature.type === "fillet" ? "Fillet" : "Chamfer"} did not produce a valid solid. Reduce the size or choose fewer edges.`, { cause: error });
  }
  return rounded;
}
/** Midpoints of every edge tangent-continuous with the seed edges (SolidCraft's tangent
 *  chain): edges meeting at a vertex with parallel tangents there, followed outward. */
function tangentChainMidpoints(body: Shape3D, seeds: readonly V3[]): V3[] {
  const edges = body.edges;
  try {
    const key = (p: {
      x: number;
      y: number;
      z: number;
    }) => `${p.x.toFixed(5)},${p.y.toFixed(5)},${p.z.toFixed(5)}`;
    const info = edges.map((edge) => {
      const s = edge.startPoint, t = edge.endPoint, m = edge.pointAt(0.5), ts = edge.tangentAt(0), te = edge.tangentAt(1);
      const out = { start: key(s), end: key(t), mid: [m.x, m.y, m.z] as V3, tStart: [ts.x, ts.y, ts.z] as V3, tEnd: [te.x, te.y, te.z] as V3 };
      s.delete();
      t.delete();
      m.delete();
      ts.delete();
      te.delete();
      return out;
    });
    const parallel = (a: V3, b: V3) => Math.abs(dot(a, b)) / Math.max(Math.hypot(...a) * Math.hypot(...b), 1e-12) > Math.cos(Math.PI / 180);
    const chosen = new Set<number>();
    const queue = info.map((_, i) => i).filter((i) => seeds.some((p) => Math.hypot(p[0] - info[i].mid[0], p[1] - info[i].mid[1], p[2] - info[i].mid[2]) < 1e-3));
    queue.forEach((i) => chosen.add(i));
    while (queue.length) {
      const i = queue.pop()!;
      for (const [vertex, tangent] of [[info[i].start, info[i].tStart], [info[i].end, info[i].tEnd]] as [
        string,
        V3
      ][]) {
        info.forEach((other, j) => {
          if (chosen.has(j))
            return;
          const shared = other.start === vertex ? other.tStart : other.end === vertex ? other.tEnd : null;
          if (shared && parallel(tangent, shared)) {
            chosen.add(j);
            queue.push(j);
          }
        });
      }
    }
    return [...chosen].map((i) => info[i].mid);
  }
  finally {
    edges.forEach((edge) => edge.delete());
  }
}
