/** Exact analyses of an evaluated document (FreeCAD's rules from
 *  `aether_freecad/analysis.py` and `properties.py`, expanded to SolidCraft 0.47 parity):
 *  physical properties (with saved material densities), combined center of mass,
 *  exact point classification, capped sections, clearance/interference with closest points,
 *  and curve/surface quality. Nothing is persisted. */
import { DistanceQuery, getOC, isShape3D, makeBaseBox, makeVertex, measureArea, measureDistanceBetween, measureVolume, type Shape3D } from "replicad";
import { evaluatePartDocument, release, solidsOf } from "./part-evaluator";
import { buildPartGeometry } from "./part-geometry";
import { analyzeCurves } from "./curve-analysis";
import { deriveCurves } from "./derived-curves";
import { projectHiddenLineView } from "./hidden-line";
import { prismaticMeshProfile } from "./mesh-convert";
import { canonicalPlaneXDirection } from "../document/construction-planes";
import type { PartDocument } from "../document/index";
import type { AnalysisOptions, AnalysisResult, PartGeometryData } from "../contracts/index";

type V3 = [number, number, number];

/** A tight box: a plain Bnd_Box is loose around spline surfaces. */
export function optimalBounds(shape: Shape3D): [V3, V3] {
  const oc = getOC();
  const box = new oc.Bnd_Box_1();
  oc.BRepBndLib.AddOptimal(shape.wrapped, box, true, false);
  const lo = box.CornerMin(), hi = box.CornerMax();
  const bounds: [V3, V3] = [[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]];
  lo.delete(); hi.delete(); box.delete();
  return bounds;
}

function closestPointsBetween(a: Shape3D, b: Shape3D): { distance: number; from: V3; to: V3 } {
  const query = new DistanceQuery(a);
  try {
    const distance = query.distanceTo(b);
    const raw = query.wrapped as unknown as {
      PointOnShape1(n: number): { X(): number; Y(): number; Z(): number; delete(): void };
      PointOnShape2(n: number): { X(): number; Y(): number; Z(): number; delete(): void };
    };
    const p1 = raw.PointOnShape1(1), p2 = raw.PointOnShape2(1);
    const from: V3 = [p1.X(), p1.Y(), p1.Z()];
    const to: V3 = [p2.X(), p2.Y(), p2.Z()];
    p1.delete(); p2.delete();
    return { distance, from, to };
  } catch {
    return { distance: measureDistanceBetween(a, b), from: [0, 0, 0], to: [0, 0, 0] };
  } finally {
    query.delete();
  }
}

/** Unit-density volume properties, with the inertia tensor about `about` (world axes). */
function volumeProperties(shape: Shape3D, about?: V3): { mass: number; center: V3; inertia: number[][] } {
  const oc = getOC();
  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(shape.wrapped, props, false, false, false);
  const c = props.CentreOfMass();
  const center: V3 = [c.X(), c.Y(), c.Z()];
  c.delete();
  const mass = props.Mass();
  const origin = about ?? center;
  const moment = (d: V3) => {
    const point = new oc.gp_Pnt_3(origin[0], origin[1], origin[2]), direction = new oc.gp_Dir_4(d[0], d[1], d[2]);
    const axis = new oc.gp_Ax1_2(point, direction);
    const value = props.MomentOfInertia(axis);
    axis.delete(); direction.delete(); point.delete();
    return value;
  };
  const s = Math.SQRT1_2;
  const xx = moment([1, 0, 0]), yy = moment([0, 1, 0]), zz = moment([0, 0, 1]);
  const xy = moment([s, s, 0]) - (xx + yy) / 2, xz = moment([s, 0, s]) - (xx + zz) / 2, yz = moment([0, s, s]) - (yy + zz) / 2;
  props.delete();
  return { mass, center, inertia: [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]] };
}

function classifyPointInShape(shape: Shape3D, pt: V3, tolerance = 1e-6): "inside" | "on" | "outside" {
  const vertex = makeVertex(pt);
  try {
    // OCCT BRepExtrema on a solid returns 0 for interior & boundary, >0 strictly outside.
    const solidDist = measureDistanceBetween(shape, vertex);
    if (solidDist > tolerance) return "outside";
    // Distinguish boundary ("on") from strict interior ("inside") via exact face distances.
    const faces = shape.faces;
    let onBoundary = false;
    try {
      for (const face of faces) {
        if (measureDistanceBetween(face, vertex) <= tolerance) {
          onBoundary = true;
          break;
        }
      }
    } finally {
      faces.forEach((f) => f.delete());
    }
    return onBoundary ? "on" : "inside";
  } finally {
    vertex.delete();
  }
}

function inspectTriangleMesh(vertices: ArrayLike<number>, triangles: ArrayLike<number>) {
  const vertexCount = Math.floor(vertices.length / 3);
  const triangleCount = Math.floor(triangles.length / 3);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const x = vertices[i * 3], y = vertices[i * 3 + 1], z = vertices[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const edgeCounts = new Map<string, number>();
  let area = 0, vol6 = 0;
  // Quantize vertices to 1e-4 mm so unwelded mesh triangles still share topological edges cleanly.
  const vKey = (idx: number) => `${Math.round(vertices[idx * 3] * 1e4)},${Math.round(vertices[idx * 3 + 1] * 1e4)},${Math.round(vertices[idx * 3 + 2] * 1e4)}`;
  const bumpEdge = (a: string, b: string) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  };
  for (let t = 0; t < triangleCount; t++) {
    const i0 = triangles[t * 3], i1 = triangles[t * 3 + 1], i2 = triangles[t * 3 + 2];
    const ax = vertices[i0 * 3], ay = vertices[i0 * 3 + 1], az = vertices[i0 * 3 + 2];
    const bx = vertices[i1 * 3], by = vertices[i1 * 3 + 1], bz = vertices[i1 * 3 + 2];
    const cx = vertices[i2 * 3], cy = vertices[i2 * 3 + 1], cz = vertices[i2 * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    vol6 += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    const k0 = vKey(i0), k1 = vKey(i1), k2 = vKey(i2);
    bumpEdge(k0, k1); bumpEdge(k1, k2); bumpEdge(k2, k0);
  }
  let boundaryEdges = 0, nonManifoldEdges = 0;
  for (const count of edgeCounts.values()) {
    if (count === 1) boundaryEdges++;
    else if (count > 2) nonManifoldEdges++;
  }
  return {
    vertex_count: vertexCount,
    triangle_count: triangleCount,
    bounds_min_mm: [minX, minY, minZ],
    bounds_max_mm: [maxX, maxY, maxZ],
    bounding_box_mm: [maxX - minX, maxY - minY, maxZ - minZ],
    surface_area_mm2: area,
    signed_volume_mm3: Math.abs(vol6) / 6,
    boundary_edge_count: boundaryEdges,
    non_manifold_edge_count: nonManifoldEdges,
    watertight: triangleCount > 0 && boundaryEdges === 0 && nonManifoldEdges === 0,
  };
}

export function analyzePart(document: PartDocument, options: AnalysisOptions): AnalysisResult {
  let shapes = new Map<string, Shape3D>();
  let meshes = new Map<string, { vertices: ArrayLike<number>; triangles: ArrayLike<number> }>();
  evaluatePartDocument(document, { withBodies: (bodies) => { shapes = new Map(bodies); }, withMeshes: (m) => { meshes = new Map(m); } });
  if (options.kind === "mesh_convert") {
    const id = options.bodyIds?.[0] ?? [...meshes.keys()][0], mesh = id ? meshes.get(id) : undefined;
    if (!mesh) throw new Error("Choose a mesh reference body to convert.");
    return { status: "ok", kind: options.kind, bodies: [], measurements: [{ body_id: id, ...prismaticMeshProfile(mesh, options.tolerance_mm ?? 0.05) }] };
  }
  if (options.kind === "mesh_inspect") {
    const out: Record<string, unknown>[] = [];
    const targetIds = options.bodyIds?.length ? options.bodyIds : [...meshes.keys(), ...shapes.keys()];
    for (const id of targetIds) {
      const m = meshes.get(id);
      if (m) {
        out.push({ body_id: id, source: "reference-mesh", ...inspectTriangleMesh(m.vertices, m.triangles) });
        continue;
      }
      const s = shapes.get(id);
      if (s) {
        const tess = s.mesh({ tolerance: options.tolerance_mm ?? 0.1, angularTolerance: 0.35 });
        out.push({ body_id: id, source: "solid-tessellation", ...inspectTriangleMesh(tess.vertices, tess.triangles) });
      }
    }
    if (!out.length) throw new Error("Mesh inspection requires at least one mesh or solid body.");
    return { status: "ok", kind: options.kind, bodies: [], measurements: out };
  }
  if (!shapes.size) throw new Error("Analysis needs at least one solid body.");
  const bodies: PartGeometryData[] = [], measurements: Record<string, unknown>[] = [];
  const render = (shape: Shape3D, id: string) => {
    try { bodies.push(buildPartGeometry(shape, document.documentId, document.name, bodies.length, { id, name: id })); }
    finally { release(shape); }
  };

  if (options.kind === "properties" || options.kind === "center_of_mass") {
    const overrideDensity = options.density_kg_m3;
    if (overrideDensity !== undefined && !(Number.isFinite(overrideDensity) && overrideDensity > 0))
      throw new Error("Density must be a positive finite value in kg/m³.");
    const entries = options.bodyIds?.length
      ? [...shapes].filter(([key]) => options.bodyIds!.includes(key))
      : [...shapes];
    if (!entries.length) throw new Error("No matching solid bodies found for properties analysis.");

    const perBody: {
      bodyId: string;
      volume: number;
      area: number;
      center: V3;
      bounds: V3;
      density?: number;
      materialName?: string;
      massKg?: number;
      inertiaKgM2?: number[][];
      unitInertia: number[][];
    }[] = [];

    for (const [key, shape] of entries) {
      const solids = solidsOf(shape);
      try {
        if (!solids.length) throw new Error("Physical properties require valid solid geometry.");
        const volumes = solids.map((solid) => measureVolume(solid));
        if (volumes.some((v) => !Number.isFinite(v) || v <= 0)) throw new Error("Physical properties require positive finite volumes.");
        const volume = volumes.reduce((a, b) => a + b, 0);
        const centers = solids.map((solid) => volumeProperties(solid).center);
        const center = [0, 1, 2].map((i) => volumes.reduce((sum, v, k) => sum + v * centers[k][i], 0) / volume) as V3;
        const [lo, hi] = optimalBounds(shape);
        const savedMat = document.bodyProperties?.[key]?.material;
        const density = overrideDensity ?? savedMat?.densityKgPerM3;
        const unitInertia = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        solids.forEach((solid, k) => {
          const tensor = volumeProperties(solid, centers[k]).inertia;
          const d = centers[k].map((c, i) => c - center[i]), d2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
          for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) unitInertia[i][j] += tensor[i][j] + volumes[k] * ((i === j ? d2 : 0) - d[i] * d[j]);
        });
        const massKg = density !== undefined ? volume * density * 1e-9 : undefined;
        const inertiaKgM2 = density !== undefined ? unitInertia.map((row) => row.map((v) => v * density * 1e-15)) : undefined;
        perBody.push({
          bodyId: key,
          volume,
          area: measureArea(shape),
          center,
          bounds: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
          density,
          materialName: overrideDensity !== undefined ? undefined : savedMat?.name,
          massKg,
          inertiaKgM2,
          unitInertia,
        });
      } finally { solids.forEach(release); }
    }

    if (options.kind === "properties") {
      for (const b of perBody) {
        const measurement: Record<string, unknown> = {
          body_id: b.bodyId,
          volume_mm3: b.volume,
          area_mm2: b.area,
          center_mm: b.center,
          bounds_mm: b.bounds,
        };
        if (b.materialName) measurement.material = b.materialName;
        if (b.density !== undefined) {
          Object.assign(measurement, {
            density_kg_m3: b.density,
            mass_kg: b.massKg,
            inertia_kg_m2: b.inertiaKgM2,
          });
        }
        measurements.push(measurement);
      }
    } else {
      // Combined Center of Mass (inspect.center_of_mass): mass-weighted if densities present, else volume-weighted.
      const totalVolume = perBody.reduce((s, b) => s + b.volume, 0);
      const allHaveMass = perBody.every((b) => b.massKg !== undefined);
      const weights = perBody.map((b) => (allHaveMass ? b.massKg! : b.volume));
      const totalWeight = weights.reduce((s, w) => s + w, 0);
      const combinedCenter: V3 = [0, 1, 2].map((i) =>
        perBody.reduce((sum, b, k) => sum + weights[k] * b.center[i], 0) / totalWeight,
      ) as V3;
      const entry: Record<string, unknown> = {
        body_ids: perBody.map((b) => b.bodyId),
        center_mm: combinedCenter,
        total_volume_mm3: totalVolume,
        weighted_by: allHaveMass ? "mass" : "volume",
      };
      if (allHaveMass) {
        const combinedInertia = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (const b of perBody) {
          const d = b.center.map((c, i) => (c - combinedCenter[i]) * 1e-3); // meters
          const d2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
          for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
              combinedInertia[i][j] += b.inertiaKgM2![i][j] + b.massKg! * ((i === j ? d2 : 0) - d[i] * d[j]);
            }
          }
        }
        entry.total_mass_kg = totalWeight;
        entry.inertia_kg_m2 = combinedInertia;
      }
      measurements.push(entry);
    }
  } else if (options.kind === "classify_points") {
    const queryPoints = options.points_mm ?? [];
    if (!queryPoints.length) throw new Error("classify_points requires at least one [x, y, z] point.");
    const entries = options.bodyIds?.length
      ? [...shapes].filter(([key]) => options.bodyIds!.includes(key))
      : [...shapes];
    const tol = options.tolerance_mm ?? 1e-6;
    for (let idx = 0; idx < queryPoints.length; idx++) {
      const pt = queryPoints[idx];
      let overall: "inside" | "on" | "outside" = "outside";
      let hitBody: string | null = null;
      for (const [key, shape] of entries) {
        const cls = classifyPointInShape(shape, pt, tol);
        if (cls === "inside") { overall = "inside"; hitBody = key; break; }
        if (cls === "on" && overall === "outside") { overall = "on"; hitBody = key; }
      }
      measurements.push({ index: idx, point_mm: pt, classification: overall, body_id: hitBody });
    }
  } else if (options.kind === "section") {
    const axis = ({ XY: 2, XZ: 1, YZ: 0 } as Record<string, number | undefined>)[options.plane ?? "XY"];
    const offset = options.offset_mm ?? 0;
    if (axis === undefined || !Number.isFinite(offset)) throw new Error("Choose a principal plane and finite offset in mm.");
    for (const [key, shape] of shapes) {
      const [lo0, hi0] = optimalBounds(shape);
      const lo = lo0.map((v) => v - 1) as V3, hi = hi0.map((v) => v + 1) as V3;
      if (options.reverse) lo[axis] = Math.max(lo[axis], offset); else hi[axis] = Math.min(hi[axis], offset);
      if ([0, 1, 2].some((i) => hi[i] <= lo[i])) continue;
      const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
      const cutter = makeBaseBox(size[0], size[1], size[2]).translate(lo[0] + size[0] / 2, lo[1] + size[1] / 2, lo[2]);
      const cut = shape.intersect(cutter);
      cutter.delete();
      if (!isShape3D(cut) || measureVolume(cut) <= 1e-9) { release(cut); continue; }
      measurements.push({ body_id: key, volume_mm3: measureVolume(cut) });
      render(cut, key);
    }
  } else if (options.kind === "interference") {
    const primary = options.bodyIds?.length ? [...shapes].filter(([id]) => options.bodyIds!.includes(id)) : [...shapes];
    const against = options.againstBodyIds?.length ? [...shapes].filter(([id]) => options.againstBodyIds!.includes(id)) : null;
    if (!against && primary.length < 2) throw new Error("Interference needs at least two body features.");
    if (primary.length > 64) throw new Error("Interference supports up to 64 bodies per check.");
    const seenPairs = new Set<string>();
    const pairs: [string, Shape3D, string, Shape3D][] = [];
    if (against) {
      for (const [idA, sA] of primary) for (const [idB, sB] of against) {
        if (idA === idB) continue;
        const pk = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
        if (!seenPairs.has(pk)) { seenPairs.add(pk); pairs.push([idA, sA, idB, sB]); }
      }
    } else {
      for (let i = 0; i < primary.length; i++) for (let j = i + 1; j < primary.length; j++) {
        pairs.push([primary[i][0], primary[i][1], primary[j][0], primary[j][1]]);
      }
    }
    const minVol = options.tolerance_mm3 ?? 1e-7;
    for (const [idA, sA, idB, sB] of pairs) {
      const overlap = sA.intersect(sB);
      let volume = 0;
      try { volume = isShape3D(overlap) ? measureVolume(overlap) : 0; } catch { volume = 0; }
      if (volume <= minVol) { release(overlap); continue; }
      const [lo, hi] = optimalBounds(overlap as Shape3D);
      const center: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
      measurements.push({ first_body_id: idA, second_body_id: idB, volume_mm3: volume, center_mm: center, bounds_mm: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] });
      render(overlap as Shape3D, `${idA}|${idB}`);
    }
  } else if (options.kind === "clearance") {
    const primary = options.bodyIds?.length ? [...shapes].filter(([id]) => options.bodyIds!.includes(id)) : [...shapes];
    const against = options.againstBodyIds?.length ? [...shapes].filter(([id]) => options.againstBodyIds!.includes(id)) : null;
    if (!against && primary.length < 2) throw new Error("Clearance needs at least two bodies.");
    const seenPairs = new Set<string>();
    const pairs: [string, Shape3D, string, Shape3D][] = [];
    if (against) {
      for (const [idA, sA] of primary) for (const [idB, sB] of against) {
        if (idA === idB) continue;
        const pk = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
        if (!seenPairs.has(pk)) { seenPairs.add(pk); pairs.push([idA, sA, idB, sB]); }
      }
    } else {
      for (let i = 0; i < primary.length; i++) for (let j = i + 1; j < primary.length; j++) {
        pairs.push([primary[i][0], primary[i][1], primary[j][0], primary[j][1]]);
      }
    }
    const raw: Record<string, unknown>[] = [];
    for (const [idA, sA, idB, sB] of pairs) {
      const overlap = sA.intersect(sB);
      let overlapping = false;
      try { overlapping = isShape3D(overlap) && measureVolume(overlap) > 1e-7; } catch { overlapping = false; }
      release(overlap);
      const closest = overlapping ? { distance: 0, from: [0, 0, 0] as V3, to: [0, 0, 0] as V3 } : closestPointsBetween(sA, sB);
      if (options.clearance_mm !== undefined && closest.distance > options.clearance_mm) continue;
      raw.push({
        first_body_id: idA,
        second_body_id: idB,
        distance_mm: closest.distance,
        overlapping,
        from_mm: closest.from,
        to_mm: closest.to,
        ...(meshes.size ? { unchecked_meshes: [...meshes.keys()] } : {}),
      });
    }
    raw.sort((a, b) => Number(a.distance_mm) - Number(b.distance_mm));
    const limited = options.nearest && options.nearest > 0 ? raw.slice(0, options.nearest) : raw;
    measurements.push(...limited);
  } else if (options.kind === "compare") {
    const chosen = options.bodyIds?.length === 2 ? options.bodyIds.map((id) => [id, shapes.get(id)] as const) : [...shapes].slice(0, 2);
    if (chosen.length < 2 || chosen.some(([, shape]) => !shape)) throw new Error("Compare needs two bodies.");
    const [[aId, aShape], [bId, bShape]] = chosen as [readonly [string, Shape3D], readonly [string, Shape3D]];
    const tolerance = options.tolerance_mm3 ?? 1e-6;
    const piece = (shape: Shape3D | import("replicad").AnyShape, key: string) => { if (!isShape3D(shape)) { release(shape); return 0; } let v = 0; try { v = measureVolume(shape); } catch { v = 0; } if (v > tolerance) render(shape, key); else release(shape); return v; };
    const onlyA = piece(aShape.cut(bShape), `${aId}-only`), onlyB = piece(bShape.cut(aShape), `${bId}-only`);
    const common = aShape.intersect(bShape); let shared = 0; try { shared = isShape3D(common) ? measureVolume(common) : 0; } catch { shared = 0; } release(common);
    measurements.push({ first_body_id: aId, second_body_id: bId, only_in_first_mm3: onlyA, only_in_second_mm3: onlyB, common_mm3: shared, identical: onlyA <= tolerance && onlyB <= tolerance });
  } else if (options.kind === "continuity" || options.kind === "curvature_comb" || options.kind === "isocurve" || options.kind === "minimum_radius") {
    const result = analyzeCurves(shapes, {
      kind: options.kind,
      entities: options.entities,
      count: options.count,
      scale: options.scale,
      radius_mm: options.radius_mm,
      position_tol_mm: options.position_tol_mm,
      tangent_tol_deg: options.tangent_tol_deg,
      curvature_tol: options.curvature_tol,
    });
    return { status: "ok", kind: options.kind, bodies, measurements: result.measurements, curves: result.curves };
  } else if (options.kind === "silhouette") {
    const rawDir = options.direction ?? [0, 0, 1];
    const dirLen = Math.hypot(rawDir[0], rawDir[1], rawDir[2]);
    if (!(dirLen > 1e-9)) throw new Error("Silhouette analysis needs a non-zero pull direction.");
    const dir: V3 = [rawDir[0] / dirLen, rawDir[1] / dirLen, rawDir[2] / dirLen];
    const xDir = canonicalPlaneXDirection(dir) as V3;
    const yDir: V3 = [
      dir[1] * xDir[2] - dir[2] * xDir[1],
      dir[2] * xDir[0] - dir[0] * xDir[2],
      dir[0] * xDir[1] - dir[1] * xDir[0],
    ];
    const entries = options.bodyIds?.length
      ? [...shapes].filter(([id]) => options.bodyIds!.includes(id))
      : [...shapes];
    const curves: { label: string; color: string; polylines: V3[][] }[] = [];
    for (const [id, shape] of entries) {
      const [lo, hi] = optimalBounds(shape);
      const midDepth = ((lo[0] + hi[0]) * 0.5) * dir[0] + ((lo[1] + hi[1]) * 0.5) * dir[1] + ((lo[2] + hi[2]) * 0.5) * dir[2];
      const view = projectHiddenLineView(shape, {
        viewNormal: dir,
        upDirection: yDir,
        chordalToleranceMillimeters: 0.05,
      });
      const sourcePolys = view.visibleOutline.length ? view.visibleOutline : view.visible;
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      const worldPolys: V3[][] = [];
      for (const poly of [...view.visibleOutline, ...view.visible]) {
        for (const [u, v] of poly) {
          if (u < minU) minU = u; if (u > maxU) maxU = u;
          if (v < minV) minV = v; if (v > maxV) maxV = v;
        }
      }
      for (const poly of sourcePolys) {
        if (poly.length < 2) continue;
        worldPolys.push(
          poly.map(([u, v]) => [
            xDir[0] * u + yDir[0] * v + dir[0] * midDepth,
            xDir[1] * u + yDir[1] * v + dir[1] * midDepth,
            xDir[2] * u + yDir[2] * v + dir[2] * midDepth,
          ]),
        );
      }
      // Compute projected area by summing half of |dot(triNormalArea, dir)| over the body's watertight surface mesh.
      const meshData = shape.mesh({ tolerance: 0.1, angularTolerance: 0.35 });
      let projectedArea = 0;
      const verts = meshData.vertices;
      const tris = meshData.triangles;
      for (let t = 0; t < tris.length; t += 3) {
        const i0 = tris[t] * 3, i1 = tris[t + 1] * 3, i2 = tris[t + 2] * 3;
        const abx = verts[i1] - verts[i0], aby = verts[i1 + 1] - verts[i0 + 1], abz = verts[i1 + 2] - verts[i0 + 2];
        const acx = verts[i2] - verts[i0], acy = verts[i2 + 1] - verts[i0 + 1], acz = verts[i2 + 2] - verts[i0 + 2];
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        // Each triangle's 2*area vector dotted with dir; half for triangle area, half again for front+back faces.
        projectedArea += Math.abs(nx * dir[0] + ny * dir[1] + nz * dir[2]) * 0.25;
      }
      if (!Number.isFinite(minU)) { minU = 0; maxU = 0; minV = 0; maxV = 0; }
      measurements.push({
        body_id: id,
        direction: dir,
        width_mm: Math.max(0, maxU - minU),
        height_mm: Math.max(0, maxV - minV),
        projected_area_mm2: projectedArea,
        silhouette_curve_count: worldPolys.length,
        bounds_2d_mm: [minU, minV, maxU, maxV],
      });
      if (worldPolys.length) curves.push({ label: `silhouette ${id}`, color: "#0ea5e9", polylines: worldPolys });
    }
    return { status: "ok", kind: options.kind, bodies, measurements, curves };
  } else if (options.kind === "intersection_curve" || options.kind === "isoparametric_curve" || options.kind === "project_curve") {
    const polylines = deriveCurves(shapes, { kind: options.kind, entities: options.entities, uv: options.uv, point_mm: options.point_mm, polylines: options.polylines, direction: options.direction });
    return { status: "ok", kind: options.kind, bodies, measurements: polylines.map((p, i) => ({ curve: i, points: p.length })), curves: polylines.map((p, i) => ({ label: `curve ${i + 1}`, color: "#3e8ef7", polylines: [p] })) };
  } else throw new Error("Choose section, interference, clearance, compare, properties, center_of_mass, classify_points, a curve analysis or distance.");
  return { status: "ok", kind: options.kind, bodies, measurements };
}
