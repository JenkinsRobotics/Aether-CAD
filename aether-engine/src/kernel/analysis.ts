/** Exact analyses of an evaluated document (FreeCAD's rules from
 *  `aether_freecad/analysis.py` and `properties.py`): physical properties,
 *  capped sections and pairwise interference. Nothing is persisted. */
import { getOC, isShape3D, makeBaseBox, measureArea, measureVolume, type Shape3D } from "replicad";
import { evaluatePartDocument, release, solidsOf } from "./part-evaluator";
import { buildPartGeometry } from "./part-geometry";
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

/** Unit-density volume properties, with the inertia tensor about `about` (world
 *  axes). gp_Mat is not bound in the wasm, so the tensor comes from moments
 *  about six axes through the point: I_d = dᵀ·I·d gives the diagonal directly
 *  and, with d = (x+y)/√2, the products Ixy = I_d − (Ixx + Iyy)/2. */
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

export function analyzePart(document: PartDocument, options: AnalysisOptions): AnalysisResult {
  let shapes = new Map<string, Shape3D>();
  evaluatePartDocument(document, { withBodies: (bodies) => { shapes = new Map(bodies); } });
  if (!shapes.size) throw new Error("Analysis needs at least one solid body.");
  const bodies: PartGeometryData[] = [], measurements: Record<string, unknown>[] = [];
  const render = (shape: Shape3D, id: string) => {
    try { bodies.push(buildPartGeometry(shape, document.documentId, document.name, bodies.length, { id, name: id })); }
    finally { release(shape); }
  };
  if (options.kind === "properties") {
    const density = options.density_kg_m3;
    if (density !== undefined && !(Number.isFinite(density) && density > 0)) throw new Error("Density must be a positive finite value in kg/m³.");
    for (const [key, shape] of shapes) {
      // A body may hold several solids: integrate them (FreeCAD's rule), never the mesh.
      const solids = solidsOf(shape);
      try {
        if (!solids.length) throw new Error("Physical properties require valid solid geometry.");
        const volumes = solids.map((solid) => measureVolume(solid));
        if (volumes.some((v) => !Number.isFinite(v) || v <= 0)) throw new Error("Physical properties require positive finite volumes.");
        const volume = volumes.reduce((a, b) => a + b, 0);
        const centers = solids.map((solid) => volumeProperties(solid).center);
        const center = [0, 1, 2].map((i) => volumes.reduce((sum, v, k) => sum + v * centers[k][i], 0) / volume) as V3;
        const [lo, hi] = optimalBounds(shape);
        const measurement: Record<string, unknown> = { body_id: key, volume_mm3: volume, area_mm2: measureArea(shape), center_mm: center, bounds_mm: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
        if (density !== undefined) {
          // Parallel-axis theorem, about the body's volume centroid.
          const inertia = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
          solids.forEach((solid, k) => {
            const tensor = volumeProperties(solid, centers[k]).inertia;
            const d = centers[k].map((c, i) => c - center[i]), d2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
            for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) inertia[i][j] += tensor[i][j] + volumes[k] * ((i === j ? d2 : 0) - d[i] * d[j]);
          });
          Object.assign(measurement, { density_kg_m3: density, mass_kg: volume * density * 1e-9, inertia_kg_m2: inertia.map((row) => row.map((v) => v * density * 1e-15)) });
        }
        measurements.push(measurement);
      } finally { solids.forEach(release); }
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
    if (shapes.size < 2) throw new Error("Interference needs at least two body features.");
    const items = [...shapes];
    if (items.length > 64) throw new Error("Interference supports up to 64 bodies per check.");
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const overlap = items[i][1].intersect(items[j][1]);
      let volume = 0;
      try { volume = isShape3D(overlap) ? measureVolume(overlap) : 0; } catch { volume = 0; }
      if (volume <= 1e-7) { release(overlap); continue; }
      measurements.push({ first_body_id: items[i][0], second_body_id: items[j][0], volume_mm3: volume });
      render(overlap, `${items[i][0]}|${items[j][0]}`);
    }
  } else throw new Error("Choose section, interference, properties or distance analysis.");
  return { status: "ok", kind: options.kind, bodies, measurements };
}
