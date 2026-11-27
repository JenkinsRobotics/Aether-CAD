import {
  assembleWire,
  cast,
  getOC,
  isShape3D,
  makeLine,
  makeNonPlanarFace,
  makeVertex,
  measureArea,
  measureDistanceBetween,
  type Edge,
  type Face,
  type Shape3D,
  type Wire,
} from "replicad";
import { splitFacesByTool } from "../general-fuse";
import { add, cross, dot, norm, scale, sub, unit, type V3 } from "../vector";

const pt = (v: { x: number; y: number; z: number; delete(): void }): V3 => {
  const p: V3 = [v.x, v.y, v.z];
  v.delete();
  return p;
};

const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function toSheet(raw: any): Shape3D {
  const o = getOC() as any;
  const shape = cast(raw) as any;
  if (isShape3D(shape)) return shape;
  const builder = new o.TopoDS_Builder();
  const shell = new o.TopoDS_Shell();
  builder.MakeShell(shell);
  builder.Add(shell, raw);
  return cast(shell) as Shape3D;
}

function sewFaces(faces: any[], tolerance = 1e-4): Shape3D {
  const o = getOC() as any;
  if (faces.length === 1) return toSheet(faces[0]);
  const sewing = new o.BRepBuilderAPI_Sewing(tolerance, true, true, true, false);
  const progress = new o.Message_ProgressRange_1();
  try {
    for (const f of faces) sewing.Add(f);
    sewing.Perform(progress);
    return toSheet(sewing.SewedShape());
  } finally {
    progress.delete();
    sewing.delete();
  }
}

/** Find a face on `body` that contains `edge` (by topology identity or geometric midpoint). */
function adjacentFaceForEdge(body: Shape3D, edge: Edge): Face | undefined {
  const mid = pt(edge.pointAt(0.5));
  const faces = body.faces;
  let match: Face | undefined;
  let bestDist = Infinity;
  for (const face of faces) {
    let hit = false;
    const faceEdges = face.edges;
    for (const fe of faceEdges) {
      if (fe.isSame(edge)) {
        hit = true;
      } else {
        const fm = pt(fe.pointAt(0.5));
        const d = dist(mid, fm);
        if (d < 1e-3 && d < bestDist) {
          bestDist = d;
          hit = true;
        }
      }
      fe.delete();
    }
    if (hit && !match) {
      match = face;
    } else if (hit && match) {
      face.delete();
    } else {
      face.delete();
    }
  }
  return match;
}

/** Extract ordered edges from an oriented wire, matching chain traversal from start to end. */
function orderedWireEdges(wire: Wire): Edge[] {
  const edges = wire.edges;
  if (edges.length <= 1) return edges;
  const start = pt(wire.startPoint);
  const endpoints = edges.map((e) => [pt(e.startPoint), pt(e.endPoint)] as [V3, V3]);
  const used = new Set<number>();
  const ordered: Edge[] = [];
  let cur = start;
  while (ordered.length < edges.length) {
    let best = -1, bestDist = Infinity, nextPt: V3 = cur;
    for (let i = 0; i < edges.length; i++) {
      if (used.has(i)) continue;
      const d0 = dist(cur, endpoints[i][0]);
      const d1 = dist(cur, endpoints[i][1]);
      if (d0 < bestDist) { bestDist = d0; best = i; nextPt = endpoints[i][1]; }
      if (d1 < bestDist) { bestDist = d1; best = i; nextPt = endpoints[i][0]; }
    }
    if (best < 0) break;
    used.add(best);
    ordered.push(edges[best]);
    cur = nextPt;
  }
  return ordered;
}

/** Surface Blend with G0, G1, or G2 continuity across two edge chains.
 *  G0 fills a minimal non-planar patch; G1/G2 uses OCCT's plate-energy BRepOffsetAPI_MakeFilling
 *  constrained to the adjacent support faces on each body. */
export function buildSurfaceBlend(
  bodyA: Shape3D,
  wireA: Wire,
  bodyB: Shape3D,
  wireB: Wire,
  continuity: "g0" | "g1" | "g2" = "g0",
): Shape3D {
  const o = getOC() as any;
  const a0 = pt(wireA.startPoint);
  const a1 = pt(wireA.endPoint);
  const b0 = pt(wireB.startPoint);
  const b1 = pt(wireB.endPoint);
  const straight = dist(a1, b1) + dist(a0, b0) <= dist(a1, b0) + dist(a0, b1);
  const [bEnd, bStart] = straight ? [b1, b0] : [b0, b1];
  const back = straight ? (cast(wireB.wrapped.Reversed()) as Wire) : wireB;

  const side1 = makeLine(a1, bEnd);
  const side2 = makeLine(bStart, a0);
  try {
    if (continuity === "g0") {
      const loop = assembleWire([wireA, side1, back, side2]);
      try {
        const face = makeNonPlanarFace(loop);
        const sheet = toSheet(face.wrapped);
        face.delete();
        if (!(measureArea(sheet as never) > 1e-9)) throw new Error("The blend surface has no area.");
        return sheet;
      } finally {
        loop.delete();
      }
    }

    const order = continuity === "g2" ? o.GeomAbs_Shape.GeomAbs_G2 : o.GeomAbs_Shape.GeomAbs_G1;
    const edgesA = orderedWireEdges(wireA);
    const edgesB = orderedWireEdges(back);
    const facesA = edgesA.map((e) => adjacentFaceForEdge(bodyA, e));
    const facesB = edgesB.map((e) => adjacentFaceForEdge(bodyB, e));
    const degree = continuity === "g2" ? 4 : 3;

    const tryFill = (ord: any, deg: number): Shape3D | null => {
      const filling = new o.BRepOffsetAPI_MakeFilling(deg, 15, 2, false, 1e-4, 1e-3, 1e-2, 1e-1, 8, 9);
      const progress = new o.Message_ProgressRange_1();
      try {
        for (let i = 0; i < edgesA.length; i++) {
          if (facesA[i]) filling.Add_2(edgesA[i].wrapped, facesA[i]!.wrapped, ord, true);
          else filling.Add_1(edgesA[i].wrapped, o.GeomAbs_Shape.GeomAbs_C0, true);
        }
        filling.Add_1(side1.wrapped, o.GeomAbs_Shape.GeomAbs_C0, true);
        for (let i = 0; i < edgesB.length; i++) {
          if (facesB[i]) filling.Add_2(edgesB[i].wrapped, facesB[i]!.wrapped, ord, true);
          else filling.Add_1(edgesB[i].wrapped, o.GeomAbs_Shape.GeomAbs_C0, true);
        }
        filling.Add_1(side2.wrapped, o.GeomAbs_Shape.GeomAbs_C0, true);
        filling.Build(progress);
        if (!filling.IsDone()) return null;
        const sheet = toSheet(filling.Shape());
        if (!(measureArea(sheet as never) > 1e-9)) {
          sheet.delete();
          return null;
        }
        return sheet;
      } catch {
        return null;
      } finally {
        progress.delete();
        filling.delete();
      }
    };

    try {
      const built =
        tryFill(order, degree) ??
        (continuity === "g2" ? tryFill(o.GeomAbs_Shape.GeomAbs_G1, 3) : null) ??
        tryFill(o.GeomAbs_Shape.GeomAbs_C0, 3);
      if (built) return built;
      // Fallback to non-planar patch if plate energy fill cannot close the boundary.
      const loop = assembleWire([wireA, side1, back, side2]);
      try {
        const face = makeNonPlanarFace(loop);
        const sheet = toSheet(face.wrapped);
        face.delete();
        if (!(measureArea(sheet as never) > 1e-9)) throw new Error("The blend surface has no area.");
        return sheet;
      } finally {
        loop.delete();
      }
    } finally {
      edgesA.forEach((e) => e.delete());
      edgesB.forEach((e) => e.delete());
      facesA.forEach((f) => f?.delete());
      facesB.forEach((f) => f?.delete());
    }
  } finally {
    side1.delete();
    side2.delete();
    if (straight) back.delete();
  }
}

/** Surface Match (`surface.match`): deforms an untrimmed source surface's boundary
 *  control-net rows to match a target edge and (for G1/G2) the target face's tangent
 *  plane and curvature across the seam. */
export function buildSurfaceMatch(
  sourceBody: Shape3D,
  sourceEdges: Edge[],
  targetBody: Shape3D,
  targetEdges: Edge[],
  continuity: "g0" | "g1" | "g2" = "g1",
): Shape3D {
  if (!sourceEdges.length || !targetEdges.length) {
    throw new Error("Surface match needs a source boundary edge and a target edge.");
  }
  const srcEdge = sourceEdges[0];
  const tgtEdge = targetEdges[0];
  const srcFace = adjacentFaceForEdge(sourceBody, srcEdge);
  if (!srcFace) throw new Error("Could not find the source face for the picked edge.");
  const tgtFace = adjacentFaceForEdge(targetBody, tgtEdge);

  const o = getOC() as any;
  const allFaces = sourceBody.faces;
  try {
    let handle: any;
    try {
      handle = o.GeomConvert.SurfaceToBSplineSurface(o.BRep_Tool.Surface_2(srcFace.wrapped));
    } catch {
      // Unbounded analytic surfaces (planes, cylinders, cones) cannot convert directly:
      // interpolate their trimmed UV domain into a bounded cubic B-spline patch.
      const nGrid = 6;
      const grid = new o.TColgp_Array2OfPnt_2(1, nGrid, 1, nGrid);
      const api = new o.GeomAPI_PointsToBSplineSurface_1();
      try {
        for (let i = 0; i < nGrid; i++) {
          for (let j = 0; j < nGrid; j++) {
            const p = srcFace.pointOnSurface(i / (nGrid - 1), j / (nGrid - 1));
            const gp = new o.gp_Pnt_3(p.x, p.y, p.z);
            grid.SetValue(i + 1, j + 1, gp);
            gp.delete();
            p.delete();
          }
        }
        api.Interpolate_1(grid, false);
        if (!api.IsDone()) throw new Error("Surface match could not build B-spline patch.");
        handle = api.Surface();
      } finally {
        api.delete();
        grid.delete();
      }
    }
    const s = handle.get();
    const minDeg = continuity === "g2" ? 3 : continuity === "g1" ? 2 : 1;
    if (s.UDegree() < minDeg || s.VDegree() < minDeg) {
      s.IncreaseDegree(Math.max(s.UDegree(), minDeg), Math.max(s.VDegree(), minDeg));
    }
    const u0 = s.UKnot(s.FirstUKnotIndex());
    const u1 = s.UKnot(s.LastUKnotIndex());
    const v0 = s.VKnot(s.FirstVKnotIndex());
    const v1 = s.VKnot(s.LastVKnotIndex());
    // Ensure enough control rows/columns to adjust G1 (row 1) and G2 (row 2) without moving opposite edge.
    const needed = continuity === "g2" ? 5 : continuity === "g1" ? 4 : 2;
    while (s.NbUPoles() < needed) s.InsertUKnot(u0 + (u1 - u0) * (s.NbUPoles() / (needed + 1)), 1, 1e-7, true);
    while (s.NbVPoles() < needed) s.InsertVKnot(v0 + (v1 - v0) * (s.NbVPoles() / (needed + 1)), 1, 1e-7, true);

    const nu = s.NbUPoles();
    const nv = s.NbVPoles();
    const pole = (i: number, j: number): V3 => {
      const p = s.Pole(i, j);
      const out: V3 = [p.X(), p.Y(), p.Z()];
      p.delete();
      return out;
    };
    const setPole = (i: number, j: number, v: V3) => {
      const q = new o.gp_Pnt_3(v[0], v[1], v[2]);
      s.SetPole_1(i, j, q);
      q.delete();
    };

    // Identify which of the 4 B-spline boundaries lies closest to sourceEdge midpoint and endpoints.
    const eStart = pt(srcEdge.startPoint);
    const eMid = pt(srcEdge.pointAt(0.5));
    const eEnd = pt(srcEdge.endPoint);
    const evalSurf = (u: number, v: number): V3 => {
      const p = s.Value(u, v);
      const out: V3 = [p.X(), p.Y(), p.Z()];
      p.delete();
      return out;
    };
    const candidates: { side: "uMin" | "uMax" | "vMin" | "vMax"; err: number }[] = [
      { side: "uMin", err: dist(evalSurf(u0, (v0 + v1) / 2), eMid) + Math.min(dist(evalSurf(u0, v0), eStart) + dist(evalSurf(u0, v1), eEnd), dist(evalSurf(u0, v0), eEnd) + dist(evalSurf(u0, v1), eStart)) },
      { side: "uMax", err: dist(evalSurf(u1, (v0 + v1) / 2), eMid) + Math.min(dist(evalSurf(u1, v0), eStart) + dist(evalSurf(u1, v1), eEnd), dist(evalSurf(u1, v0), eEnd) + dist(evalSurf(u1, v1), eStart)) },
      { side: "vMin", err: dist(evalSurf((u0 + u1) / 2, v0), eMid) + Math.min(dist(evalSurf(u0, v0), eStart) + dist(evalSurf(u1, v0), eEnd), dist(evalSurf(u0, v0), eEnd) + dist(evalSurf(u1, v0), eStart)) },
      { side: "vMax", err: dist(evalSurf((u0 + u1) / 2, v1), eMid) + Math.min(dist(evalSurf(u0, v1), eStart) + dist(evalSurf(u1, v1), eEnd), dist(evalSurf(u0, v1), eEnd) + dist(evalSurf(u1, v1), eStart)) },
    ];
    candidates.sort((a, b) => a.err - b.err);
    const side = candidates[0].side;

    const alongCount = side === "uMin" || side === "uMax" ? nv : nu;
    const getRow = (depth: number, k: number): V3 => {
      if (side === "uMin") return pole(1 + depth, k + 1);
      if (side === "uMax") return pole(nu - depth, k + 1);
      if (side === "vMin") return pole(k + 1, 1 + depth);
      return pole(k + 1, nv - depth);
    };
    const setRow = (depth: number, k: number, v: V3) => {
      if (side === "uMin") setPole(1 + depth, k + 1, v);
      else if (side === "uMax") setPole(nu - depth, k + 1, v);
      else if (side === "vMin") setPole(k + 1, 1 + depth, v);
      else setPole(k + 1, nv - depth, v);
    };

    // Orient target edge sampling so index 0 matches pole 0 (no twist).
    const t0 = pt(tgtEdge.startPoint);
    const t1 = pt(tgtEdge.endPoint);
    const pStart = getRow(0, 0);
    const pEnd = getRow(0, alongCount - 1);
    const flipTarget = dist(pStart, t1) + dist(pEnd, t0) < dist(pStart, t0) + dist(pEnd, t1);

    for (let k = 0; k < alongCount; k++) {
      const frac = alongCount === 1 ? 0.5 : k / (alongCount - 1);
      const t = flipTarget ? 1 - frac : frac;
      const targetPt = pt(tgtEdge.pointAt(t));
      const old0 = getRow(0, k);
      const old1 = getRow(1, k);
      const shift = sub(targetPt, old0);

      // G0: place boundary pole directly on target edge.
      setRow(0, k, targetPt);

      if (continuity === "g0") {
        continue;
      }

      // G1: project the adjacent interior row into the target face's tangent plane
      // while preserving its step length away from the boundary.
      let row1 = add(old1, scale(shift, 0.5));
      if (tgtFace) {
        const nvVec = tgtFace.normalAt(targetPt);
        const tgtNormal = unit([nvVec.x, nvVec.y, nvVec.z]);
        nvVec.delete();
        const delta = sub(row1, targetPt);
        const proj = sub(delta, scale(tgtNormal, dot(delta, tgtNormal)));
        const projLen = norm(proj);
        const origLen = Math.max(norm(sub(old1, old0)), 1e-3);
        if (projLen > 1e-9) {
          row1 = add(targetPt, scale(proj, origLen / projLen));
        } else {
          // Edge tangent × target normal gives an in-plane direction perpendicular to edge.
          const tang = pt(tgtEdge.tangentAt(t));
          const inPlane = unit(cross(tgtNormal, unit(tang)));
          const sign = dot(sub(old1, old0), inPlane) >= 0 ? 1 : -1;
          row1 = add(targetPt, scale(inPlane, sign * origLen));
        }
      }
      setRow(1, k, row1);

      // G2: smoothly align row 2 to match target normal curvature across the seam.
      if (continuity === "g2" && tgtFace) {
        const old2 = getRow(2, k);
        const nvVec = tgtFace.normalAt(targetPt);
        const tgtNormal = unit([nvVec.x, nvVec.y, nvVec.z]);
        nvVec.delete();
        const delta2 = sub(old2, row1);
        const proj2 = sub(delta2, scale(tgtNormal, dot(delta2, tgtNormal)));
        const origLen2 = Math.max(norm(sub(old2, old1)), 1e-3);
        const row2 = norm(proj2) > 1e-9
          ? add(row1, scale(proj2, origLen2 / norm(proj2)))
          : add(row1, sub(row1, targetPt));
        setRow(2, k, row2);
      }
    }

    const maker = new o.BRepBuilderAPI_MakeFace_8(new o.Handle_Geom_Surface_2(s), 1e-6);
    if (!maker.IsDone()) throw new Error("Surface match could not rebuild the matched face.");
    const matchedFace = maker.Face();
    maker.delete();

    const kept: any[] = [];
    for (const f of allFaces) {
      if (!f.isSame(srcFace)) kept.push(f.wrapped);
    }
    kept.push(matchedFace);
    return sewFaces(kept, 1e-4);
  } finally {
    allFaces.forEach((f) => f.delete());
    srcFace.delete();
    tgtFace?.delete();
  }
}

/** Surface Fillet (`surface.fillet`): builds a constant-radius fillet across shared or
 *  intersecting edges of one or two surface sheets. */
export function buildSurfaceFillet(
  bodiesList: Shape3D[],
  pickedEdges: Edge[] | undefined,
  radiusMillimeters: number,
): Shape3D {
  if (!bodiesList.length || bodiesList.length > 2) {
    throw new Error("Surface fillet needs one or two surface bodies.");
  }
  const o = getOC() as any;
  let combined: Shape3D;
  if (bodiesList.length === 1) {
    combined = bodiesList[0].clone();
  } else {
    // First attempt direct sewing (when the two sheets share a boundary edge).
    const facesA = bodiesList[0].faces;
    const facesB = bodiesList[1].faces;
    const sewn = sewFaces([...facesA.map((f) => f.wrapped), ...facesB.map((f) => f.wrapped)], 1e-2);
    facesA.forEach((f) => f.delete());
    facesB.forEach((f) => f.delete());

    // Check whether any edge is shared by >= 2 faces in `sewn`; if not, split via general fuse.
    const countShared = (shape: Shape3D): Edge[] => {
      const counts = new Map<string, { edge: Edge; count: number }>();
      const fs = shape.faces;
      for (const f of fs) {
        const es = f.edges;
        for (const e of es) {
          const m = pt(e.pointAt(0.5));
          const key = m.map((v) => Math.round(v * 100)).join(",");
          const prev = counts.get(key);
          if (prev) {
            prev.count++;
            e.delete();
          } else {
            counts.set(key, { edge: e, count: 1 });
          }
        }
        f.delete();
      }
      const shared: Edge[] = [];
      for (const entry of counts.values()) {
        if (entry.count >= 2) shared.push(entry.edge);
        else entry.edge.delete();
      }
      return shared;
    };

    const directShared = countShared(sewn);
    if (directShared.length > 0) {
      directShared.forEach((e) => e.delete());
      combined = sewn;
    } else {
      sewn.delete();
      const fa = bodiesList[0].faces;
      const fb = bodiesList[1].faces;
      try {
        const piecesA = splitFacesByTool(fa, bodiesList[1]).flat();
        const piecesB = splitFacesByTool(fb, bodiesList[0]).flat();
        // Pick the largest piece from each sheet that touches the intersection seam.
        piecesA.sort((x, y) => measureArea(y) - measureArea(x));
        piecesB.sort((x, y) => measureArea(y) - measureArea(x));
        combined = sewFaces([piecesA[0].wrapped, piecesB[0].wrapped], 1e-2);
        piecesA.forEach((p) => p.delete());
        piecesB.forEach((p) => p.delete());
      } finally {
        fa.forEach((f) => f.delete());
        fb.forEach((f) => f.delete());
      }
    }
  }

  try {
    // Collect edges to fillet: either matching pickedEdges or all internal edges shared by 2 faces.
    const targetEdges: Edge[] = [];
    const seenKeys = new Map<string, { edge: Edge; count: number }>();
    const fs = combined.faces;
    for (const f of fs) {
      const es = f.edges;
      for (const e of es) {
        const m = pt(e.pointAt(0.5));
        const key = m.map((v) => Math.round(v * 100)).join(",");
        const prev = seenKeys.get(key);
        if (prev) {
          prev.count++;
          e.delete();
        } else {
          seenKeys.set(key, { edge: e, count: 1 });
        }
      }
      f.delete();
    }
    const pickedMids = (pickedEdges ?? []).map((e) => pt(e.pointAt(0.5)));
    for (const entry of seenKeys.values()) {
      if (entry.count >= 2) {
        if (!pickedMids.length) {
          targetEdges.push(entry.edge);
        } else {
          const m = pt(entry.edge.pointAt(0.5));
          if (pickedMids.some((pm) => dist(m, pm) < 1e-2)) targetEdges.push(entry.edge);
          else entry.edge.delete();
        }
      } else {
        entry.edge.delete();
      }
    }
    if (!targetEdges.length) {
      throw new Error("Surface fillet needs a shared seam edge between two adjacent surface faces.");
    }

    const builder = new o.BRepFilletAPI_MakeFillet(combined.wrapped, o.ChFi3d_FilletShape.ChFi3d_Rational);
    const progress = new o.Message_ProgressRange_1();
    try {
      for (const e of targetEdges) builder.Add_2(radiusMillimeters, e.wrapped);
      builder.Build(progress);
      if (!builder.IsDone()) throw new Error("Surface fillet failed — reduce radius or verify that the surfaces meet cleanly.");
      const sheet = toSheet(builder.Shape());
      if (!(measureArea(sheet as never) > 1e-9)) {
        sheet.delete();
        throw new Error("Surface fillet produced no surface area.");
      }
      return sheet;
    } finally {
      progress.delete();
      builder.delete();
      targetEdges.forEach((e) => e.delete());
    }
  } finally {
    combined.delete();
  }
}

/** Trim a surface body by another surface or solid body (`surface-trim` with `toolBodyId`),
 *  keeping the connected region containing `keepPointMillimeters`. */
export function trimSurfaceByBody(
  body: Shape3D,
  toolBody: Shape3D,
  keepPointMillimeters: V3,
): Shape3D {
  const faces = body.faces;
  let pieces: Face[] = [];
  try {
    pieces = splitFacesByTool(faces, toolBody).flat();
  } finally {
    faces.forEach((f) => f.delete());
  }
  if (pieces.length <= 1) {
    pieces.forEach((p) => p.delete());
    throw new Error("The trimming body does not split the surface.");
  }

  const probe = makeVertex(keepPointMillimeters);
  let seedIndex = 0;
  let bestDist = Infinity;
  try {
    pieces.forEach((p, idx) => {
      const d = measureDistanceBetween(probe, p);
      if (d < bestDist) {
        bestDist = d;
        seedIndex = idx;
      }
    });
  } finally {
    probe.delete();
  }

  // Build adjacency graph across edges NOT lying on `toolBody` (so flood-fill stops at the cut).
  const edgeKeys: Map<string, number[]> = new Map();
  pieces.forEach((p, idx) => {
    const es = p.edges;
    for (const e of es) {
      const mid = pt(e.pointAt(0.5));
      const mv = makeVertex(mid);
      const onCut = measureDistanceBetween(mv, toolBody) < 1e-2;
      mv.delete();
      e.delete();
      if (onCut) continue;
      const key = mid.map((v) => Math.round(v * 50)).join(",");
      const list = edgeKeys.get(key) ?? [];
      list.push(idx);
      edgeKeys.set(key, list);
    }
  });

  const adj: Set<number>[] = pieces.map(() => new Set());
  for (const list of edgeKeys.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        adj[list[i]].add(list[j]);
        adj[list[j]].add(list[i]);
      }
    }
  }

  const visited = new Set<number>([seedIndex]);
  const queue = [seedIndex];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adj[cur]) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }

  if (visited.size === pieces.length) {
    // If every piece remained reachable through non-cut edges, fall back to keeping the seed face alone.
    visited.clear();
    visited.add(seedIndex);
  }

  try {
    const kept = [...visited].map((i) => pieces[i].wrapped);
    return sewFaces(kept, 1e-4);
  } finally {
    pieces.forEach((p) => p.delete());
  }
}
