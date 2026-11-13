import { cast, FaceFinder, getOC, isShape3D, Plane, type Face, type Shape3D, type EdgeFinder, type RadiusConfig, type FilletRadius, type ChamferRadius } from "replicad";
import type { EdgeFinishEdge, PartFeature } from "../../document/index";
import type { PreviewHandle } from "../../contracts/geometry";
import { deleteAfterVectorTuple } from "../../geometry/index";
import { straightEdgeMidpoint } from "../native-straight-edge";
import { add, scale, norm, unit, dot, type V3 } from "../vector";
import { recoverEdgeFinish, validFinishSolid, type AddFinishEdge } from './edge-finish-recovery';
import type { BRepFilletAPI_MakeChamfer } from 'replicad-opencascadejs';
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
/** The midpoint of every picked edge, found again on the body: a straight edge by its vertex
 *  anchors, any edge by midpoint and length, a picked face by every edge of that face. Shared by
 *  the finishes and the parting-line draft. */
export function pickedEdgePoints(edges: readonly EdgeFinishEdge[], bodyId: string, body: Shape3D, faceByReference: EdgeFinishContext["faceByReference"], verb: string): { point: V3; size?: number }[] {
  return edges.flatMap((pick): { point: V3; size?: number }[] => {
    if (pick.bodyId !== bodyId)
      throw new Error(`${pick.label} is on another body. Reselect edges on the target body.`);
    const refuse = () => new Error(`${pick.label} changed or is missing. Reselect the edges to ${verb}.`);
    if (pick.kind === "face-edges") {
      const face = faceByReference(body, pick, "Entities to finish"), edges = face.edges;
      const points = edges.map((edge) => { const m = edge.pointAt(0.5), point: V3 = [m.x, m.y, m.z]; m.delete(); return { point, size: pick.radiusMillimeters }; });
      edges.forEach((edge) => edge.delete()); face.delete();
      if (!points.length) throw refuse();
      return points;
    }
    const point = ((): V3 => {
    if (pick.kind === "solid-edge") {
      return straightEdgeMidpoint(body, pick);
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
    })();
    return [{ point, size: pick.radiusMillimeters }];
  });
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
  // A picked face is every edge of that face: the same pipeline, the face just selects them.
  const picks = feature.edges && pickedEdgePoints(feature.edges, bodyId, body, faceByReference, "finish");
  const pickedPoints = picks?.map((pick) => pick.point);
  const chainPoints = pickedPoints && feature.tangentChain ? tangentChainMidpoints(body, pickedPoints) : pickedPoints;
  // Onshape's measurements: a fillet by the width between its tangent lines, a chamfer by the
  // width across its face. Both convert through the dihedral angle β between the faces at the
  // edge: radius = width / (2 sin(β/2)), offset = width / (2 cos(β/2)); a 90° edge gives √2.
  const dihedralSine = (point: V3, cosine: boolean): number => {
    const faces = new FaceFinder().containsPoint(point).find(body);
    const normals = faces.slice(0, 2).map((face) => { const n = face.normalAt(point); const v: V3 = [n.x, n.y, n.z]; n.delete(); return unit(v); });
    faces.forEach((face) => face.delete());
    if (normals.length < 2) return 1;
    const beta = Math.acos(Math.max(-1, Math.min(1, dot(normals[0], normals[1]))));
    const value = cosine ? Math.cos(beta / 2) : Math.sin(beta / 2);
    return value < 1e-3 ? 1 : value;
  };
  const measured = (point: V3, value: number): number => feature.type === "fillet"
    ? (feature.measurement === "width" ? value / (2 * dihedralSine(point, false)) : value)
    : (feature.measurement === "tangent" ? value / (2 * dihedralSine(point, true)) : value);
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
  const size = feature.radiusMillimeters!; // validated present for every edge finish; absent only on a Full round, built elsewhere
  const filletRadius = (): RadiusConfig<FilletRadius> => {
    const end = feature.type === "fillet" ? feature.endRadiusMillimeters : undefined;
    const perEdge = picks && (picks.some((pick) => pick.size !== undefined) || feature.measurement === "width");
    if (!perEdge)
      return end !== undefined ? [size, end] : size;
    return (edge) => {
      const m = edge.pointAt(0.5), at: V3 = [m.x, m.y, m.z];
      const i = picks!.findIndex((pick) => near(pick.point, m));
      const inChain = chainPoints!.some((p) => near(p, m));
      m.delete();
      if (i < 0 && !inChain) return null;
      const own = i >= 0 ? picks![i].size : undefined;
      const start = measured(at, own ?? size);
      return end !== undefined && own === undefined ? [start, measured(at, end)] : start;
    };
  };
  // Onshape's points on the edge: OCCT's fillet takes a (position, radius) law per edge, here the
  // same law on every picked edge: the size at the start, the points in order, the end radius at the end.
  const filletThroughPoints = (): Shape3D => {
    if (feature.type !== "fillet" || !chainPoints) throw new Error("A fillet through points on the edge needs picked edges.");
    const oc = getOC(), law = [{ position: 0, radiusMillimeters: size }, ...feature.points!.slice().sort((a, b) => a.position - b.position), { position: 1, radiusMillimeters: feature.endRadiusMillimeters ?? size }];
    const builder = new oc.BRepFilletAPI_MakeFillet(body.wrapped, oc.ChFi3d_FilletShape.ChFi3d_Rational as never), progress = new oc.Message_ProgressRange_1();
    const temps: { delete(): void }[] = [], edges = body.edges;
    try {
      let added = 0;
      for (const edge of edges) {
        const m = edge.pointAt(0.5), hit = chainPoints.some((p) => near(p, m)); m.delete();
        if (!hit) continue;
        const table = new oc.TColgp_Array1OfPnt2d_2(1, law.length); temps.push(table);
        law.forEach((row, index) => { const p = new oc.gp_Pnt2d_3(row.position, row.radiusMillimeters); temps.push(p); table.SetValue(index + 1, p); });
        builder.Add_5(table, edge.wrapped); added++;
      }
      if (!added) throw new Error("Could not fillet, no edge was selected");
      builder.Build(progress);
      const made = cast(builder.Shape());
      if (!isShape3D(made)) { made.delete(); throw new Error("Fillet through points did not produce a solid."); }
      return made;
    } finally { edges.forEach((edge) => edge.delete()); temps.reverse().forEach((t) => t.delete()); builder.delete(); progress.delete(); }
  };
  // An asymmetric chamfer needs, per edge, the face its first leg lies on: the picked reference
  // face, else the adjacent face facing up most (SolidCraft's default); the flip moves it to the
  // other adjacent face, and Direction overrides flip single edges. Kept as that face's normal at
  // the edge midpoint, so a recovery pass on a partly finished body finds the same side again.
  const asymmetric = feature.type === "chamfer" && (feature.secondDistanceMillimeters !== undefined || feature.angleDegrees !== undefined) ? feature : undefined;
  const legNormals = asymmetric && chainPoints && (() => {
    const overrides = asymmetric.flippedEdges?.flatMap((pick): V3[] => {
      if (pick.kind === "face-edges") { const face = faceByReference(body, pick, "Direction override"), edges = face.edges; const points = edges.map((edge) => { const m = edge.pointAt(0.5), q: V3 = [m.x, m.y, m.z]; m.delete(); return q; }); edges.forEach((edge) => edge.delete()); face.delete(); return points; }
      if (pick.kind === "solid-edge") { const a = pick.anchor.start.positionMillimeters, b = pick.anchor.end.positionMillimeters; return [scale(add(a as V3, b as V3), 0.5)]; }
      return [pick.midpointMillimeters as V3];
    }) ?? [];
    const explicit = asymmetric.referenceFace ? faceByReference(body, asymmetric.referenceFace, "Chamfer reference face") : undefined;
    try {
      return chainPoints.map((point): V3 | null => {
        // The faces meeting at the edge, the one facing up most first.
        const adjacent = new FaceFinder().containsPoint(point).find(body);
        // A full revolve's centre of mass is off its surface (on the axis): use the normal at the edge there.
        const up = (face: Face) => { try { const center = deleteAfterVectorTuple(face.center); return deleteAfterVectorTuple(face.normalAt([center[0], center[1], center[2]]))[2]; } catch { return deleteAfterVectorTuple(face.normalAt(point))[2]; } };
        adjacent.sort((a, b) => up(b) - up(a));
        try {
          if (adjacent.length < 2) return null; // a seam: one face on both sides, nothing to chamfer
          const here = { x: point[0], y: point[1], z: point[2] };
          const flip = Boolean(asymmetric.flipped) !== overrides.some((p) => near(p, here));
          const first = explicit ? Math.max(0, adjacent.findIndex((face) => face.isSame(explicit))) : 0;
          return [...deleteAfterVectorTuple(adjacent[flip ? 1 - Math.min(first, 1) : first].normalAt(point))] as V3;
        } finally { adjacent.forEach((face) => face.delete()); }
      });
    } finally { explicit?.delete(); }
  })();
  // The face at `point` on `shape` whose normal there matches the recorded first-leg side; null on a seam.
  const legFace = (shape: Shape3D, point: V3): Face | null => {
    const normal = legNormals?.[chainPoints!.findIndex((p) => near(p, { x: point[0], y: point[1], z: point[2] }))];
    if (!normal) return null;
    const faces = new FaceFinder().containsPoint(point).find(shape);
    const score = (face: Face) => dot([...deleteAfterVectorTuple(face.normalAt(point))] as V3, normal);
    faces.sort((a, b) => score(b) - score(a));
    faces.slice(1).forEach((face) => face.delete());
    if (!faces[0]) throw new Error("Chamfer reference face could not be found. Pick the reference face.");
    return own(faces[0]);
  };
  const chamferRadius = (): RadiusConfig<ChamferRadius> => {
    if (!asymmetric)
      return feature.measurement === "tangent" && chainPoints
        ? (edge) => { const m = edge.pointAt(0.5), at: V3 = [m.x, m.y, m.z]; const hit = chainPoints.some((p) => near(p, m)); m.delete(); return hit ? measured(at, size) : null; }
        : size;
    const config = (reference: Face): ChamferRadius => {
      const selectedFace = (f: FaceFinder) => f.inList([reference]);
      return asymmetric.angleDegrees !== undefined ? { distance: size, angle: asymmetric.angleDegrees, selectedFace } : { distances: [size, asymmetric.secondDistanceMillimeters!], selectedFace };
    };
    // Every edge in a plane (saved documents): one picked reference face for all of them.
    if (!chainPoints) {
      if (!asymmetric.referenceFace) throw new Error("An asymmetric chamfer needs picked edges or a reference face.");
      return config(own(faceByReference(body, asymmetric.referenceFace, "Chamfer reference face")));
    }
    return (edge) => {
      const m = edge.pointAt(0.5), at: V3 = [m.x, m.y, m.z]; m.delete();
      if (!chainPoints!.some((p) => near(p, { x: at[0], y: at[1], z: at[2] }))) return null;
      const reference = legFace(body, at);
      return reference ? config(reference) : null;
    };
  };
  const addEdge: AddFinishEdge = (builder, edge, point, shape) => {
    if (!asymmetric) { builder.Add_2(size, edge.wrapped); return; }
    const chamfer = builder as BRepFilletAPI_MakeChamfer, face = legFace(shape, point);
    if (!face) return;
    if (asymmetric.angleDegrees !== undefined) chamfer.AddDA(size, asymmetric.angleDegrees * Math.PI / 180, edge.wrapped, face.wrapped);
    else chamfer.Add_3(size, asymmetric.secondDistanceMillimeters!, edge.wrapped, face.wrapped);
  };
  let rounded: Shape3D;
  try {
    rounded = feature.type === "fillet" && feature.points?.length ? filletThroughPoints() : feature.type === "fillet" ? body.fillet(filletRadius(), filter) : body.chamfer(chamferRadius(), filter);
    if (!validFinishSolid(rounded)) { rounded.delete(); throw new Error("Invalid finished solid."); }
  }
  catch (error) {
    const constantSize = asymmetric !== undefined || (feature.type === 'fillet'
      ? feature.endRadiusMillimeters === undefined && !feature.points?.length && feature.measurement !== 'width'
      : feature.measurement !== 'tangent');
    if (constantSize && chainPoints && chainPoints.length > 1 && !picks?.some(p => p.size !== undefined)) {
      try { return recoverEdgeFinish(feature.type, body, chainPoints, addEdge); }
      catch { /* Preserve the failure; never commit a partial edge set. */ }
    }
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
