/** Mesh to solid for constant-section parts (SolidCraft's mesh.convert): a closed mesh whose
 *  every vertex lies on one of two parallel cap planes is one profile extruded straight. The
 *  profile is the mesh's section halfway between the caps, fitted with lines, arcs and circles;
 *  the app writes it as an ordinary sketch on the lower cap plus an extrusion, so the converted
 *  part is fully editable. Anything else is refused rather than approximated. */
import type { SketchContour, SketchFrame } from "../sketch/drawing";
import { canonicalPlaneXDirection } from "../document/construction-planes";
import { fitLinesAndArcs, meshSectionPolylines } from "./sketch-section";

type V3 = [number, number, number];
export interface PrismaticProfile { frame: SketchFrame; depthMillimeters: number; contours: SketchContour[] }

export function prismaticMeshProfile(mesh: { vertices: ArrayLike<number>; triangles: ArrayLike<number> }, tolerance = 0.05): PrismaticProfile {
  if (!(tolerance > 0 && tolerance <= 1)) throw new Error("Conversion tolerance must be between 0 and 1 mm.");
  const count = mesh.triangles.length / 3;
  if (!count) throw new Error("The mesh is empty.");
  if (count > 50_000) throw new Error(`The mesh has ${count} triangles, more than the 50,000 conversion takes.`);
  const v = (i: number): V3 => [mesh.vertices[3 * i], mesh.vertices[3 * i + 1], mesh.vertices[3 * i + 2]];
  const normals: { n: V3; area: number }[] = [];
  for (let t = 0; t < count; t++) {
    const [a, b, c] = [v(mesh.triangles[3 * t]), v(mesh.triangles[3 * t + 1]), v(mesh.triangles[3 * t + 2])];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: V3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...n);
    if (l > 1e-12) normals.push({ n: [n[0] / l, n[1] / l, n[2] / l], area: l / 2 });
  }
  // The extrusion axis: a triangle normal every other normal is parallel or perpendicular to.
  const fits = (a: V3) => normals.every(({ n }) => { const d = Math.abs(n[0] * a[0] + n[1] * a[1] + n[2] * a[2]); return d > 1 - 1e-3 || d < 1e-3; })
    && normals.some(({ n }) => n[0] * a[0] + n[1] * a[1] + n[2] * a[2] > 1 - 1e-3) && normals.some(({ n }) => n[0] * a[0] + n[1] * a[1] + n[2] * a[2] < -(1 - 1e-3));
  // Candidates: the largest facet's normal (a cap), and its cross product with the first normal
  // not parallel to it (the axis, when both are side facets).
  const n0 = normals.reduce((a, b) => (b.area > a.area ? b : a)).n;
  const other = normals.find(({ n }) => Math.abs(n[0] * n0[0] + n[1] * n0[1] + n[2] * n0[2]) < 1 - 1e-3)?.n;
  const candidates: V3[] = [n0];
  if (other) { const c: V3 = [n0[1] * other[2] - n0[2] * other[1], n0[2] * other[0] - n0[0] * other[2], n0[0] * other[1] - n0[1] * other[0]], l = Math.hypot(...c); if (l > 1e-9) candidates.push([c[0] / l, c[1] / l, c[2] / l]); }
  let axis = candidates.find(fits);
  if (!axis) throw new Error("This mesh is not one profile extruded straight: no direction has every face parallel or square to it.");
  // Keep a positive-leaning axis so the sketch normal reads naturally.
  const lead = Math.abs(axis[2]) > 1e-9 ? axis[2] : Math.abs(axis[1]) > 1e-9 ? axis[1] : axis[0];
  if (lead < 0) axis = [-axis[0], -axis[1], -axis[2]];
  const heights: number[] = [];
  for (let i = 0; i < mesh.vertices.length / 3; i++) { const p = v(i); heights.push(p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2]); }
  let h0 = Infinity, h1 = -Infinity;
  for (const h of heights) { if (h < h0) h0 = h; if (h > h1) h1 = h; }
  if (h1 - h0 <= tolerance) throw new Error("The mesh is flat along its extrusion direction.");
  if (heights.some((h) => Math.abs(h - h0) > tolerance && Math.abs(h - h1) > tolerance)) throw new Error("This mesh is not one profile extruded straight: it has vertices between its two caps.");
  const x = canonicalPlaneXDirection(axis) as V3;
  const at = (h: number): V3 => [axis![0] * h, axis![1] * h, axis![2] * h];
  const polylines = meshSectionPolylines(mesh, { originMillimeters: at((h0 + h1) / 2), xDirection: x, normal: axis });
  if (!polylines.length) throw new Error("The mesh has no section between its caps.");
  if (polylines.some((p) => p.length < 3 || Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) > 1e-6)) throw new Error("The mesh is not closed: its section has open ends.");
  return { frame: { originMillimeters: at(h0), xDirection: x, normal: axis }, depthMillimeters: h1 - h0, contours: polylines.flatMap((p) => fitLinesAndArcs(p, tolerance)) };
}
