import {
  addHolesInFace, assembleWire, cast, getOC, makeFace, makeSolid, makeVertex, measureDistanceBetween,
  measureVolume, type Edge, type Face, type Shape3D, type Vector, type Wire,
} from 'replicad';
import { extrusionDraftWallNormal } from './extrusion-draft-wall';
import { add, cross, dot, norm, scale, sub, unit, type V3 } from './vector';

const tolerance = 1e-7;
const failure = 'Draft collapses or intersects the profile. Reduce the angle, depth or starting offset.';
const tuple = (vector: Vector): V3 => { try { return vector.toTuple(); } finally { vector.delete(); } };
type Section = { outer: Wire; holes: Wire[] };

export function hasCurvedDraftBoundary(sections: Section[]): boolean {
  return sections.some(section => [section.outer, ...section.holes].some(wire => {
    const edges = wire.edges;
    try { return edges.some(edge => edge.geomType !== 'LINE'); }
    finally { edges.forEach(edge => edge.delete()); }
  }));
}

/** A constant-angle developable wall. Its normal m is perpendicular to the
 * authored tangent and satisfies m·pull = sin(angle). The ruling is the pull's
 * projection onto that wall: pull - sin(angle)*m. A shear of an ordinary tapered
 * loft, or a fixed rotation about the sketch tangent, does not satisfy this.
 * Smooth native boundaries are fitted to B-spline surfaces with checked position
 * and normal tolerances. The result remains native editable B-rep geometry.
 */
export function curvedDraftPrism(sections: Section[], direction: V3, normal: V3,
  low: number, high: number, degrees: number): Shape3D {
  const owned: { delete(): void }[] = [];
  const own = <T extends { delete(): void }>(value: T): T => { owned.push(value); return value; };
  const sides: Face[] = [], starts: Wire[] = [], ends: Wire[] = [];
  const sine = Math.sin(degrees * Math.PI / 180), alignment = dot(direction, normal);
  const oc = getOC();
  let result: Shape3D | undefined;
  try {
    for (const section of sections) {
      starts.length = 0; ends.length = 0; sides.length = 0;
      for (const [index, wire] of [section.outer, ...section.holes].entries()) {
        const base = own(makeFace(own(wire.clone()))), oriented = own(base.clone().outerWire());
        const faceNormal = unit(tuple(base.normalAt()));
        const edges = oriented.edges.map(own);
        requireSmoothBoundary(edges);
        const bottom: Edge[] = [], top: Edge[] = [];
        for (const edge of edges) {
          const orientation = edge.orientation === 'forward' ? 1 : -1;
          const point = (u: number, distance: number): V3 => {
            const p = tuple(edge.pointAt(u));
            const tangent = scale(unit(tuple(edge.tangentAt(u))), orientation);
            const outward = scale(unit(cross(tangent, faceNormal)), index === 0 ? 1 : -1);
            const m = extrusionDraftWallNormal(outward, normal, direction, degrees);
            const ruling = sub(direction, scale(m, sine));
            const across = dot(ruling, normal);
            if (Math.abs(across) < 1e-9 || across * alignment <= 0) throw Error(failure);
            return add(p, scale(ruling, distance * alignment / across));
          };
          // Bound each interpolation system. If a patch misses tolerance,
          // subdivide its native parameter interval instead of accumulating an
          // ill-conditioned high-order fit over hundreds of samples.
          const appendPatch = (a: number, b: number, depth = 0) => {
            const sample = (u: number, distance: number) => point(a + (b - a) * u, distance);
            requireRegularWall(sample, low, high);
            const fitted = fitWall(sample, low, high, direction, sine);
            if (!fitted) {
              if (depth >= 7) throw Error('The curved draft cannot meet the modeling tolerance. Reduce the angle or repair the profile.');
              const middle = (a + b) / 2;
              appendPatch(a, middle, depth + 1); appendPatch(middle, b, depth + 1);
              return;
            }
            sides.push(own(fitted.face)); bottom.push(own(fitted.start)); top.push(own(fitted.end));
          };
          for (let patch = 0; patch < 4; patch++) appendPatch(patch / 4, (patch + 1) / 4);
        }
        starts.push(own(assembleWire(bottom))); ends.push(own(assembleWire(top)));
      }
      const cap = (wires: Wire[]) => {
        const outer = own(makeFace(wires[0]));
        // Each fitted loop is built independently. Orient interior wires in
        // the cap's parameter space before sewing; their input winding need
        // not be opposite to that of the outer boundary.
        return wires.length > 1 ? own(addHolesInFace(outer, wires.slice(1))) : outer;
      };
      const start = cap(starts), end = cap(ends);
      const solid = own(makeSolid([...sides, start, end]));
      const check = own(new oc.BRepCheck_Analyzer(solid.wrapped, true, false));
      if (!check.IsValid_2() || measureVolume(solid) <= 1e-9) throw Error(failure);
      result = result ? own(result.fuse(solid)) : solid;
    }
    if (!result) throw Error('Draft requires a closed planar profile.');
    return result.clone();
  } catch (error) {
    if (error instanceof Error) throw error;
    throw Error(failure, { cause: error });
  } finally { owned.reverse().forEach(value => value.delete()); }
}

function requireSmoothBoundary(edges: Edge[]): void {
  const endpoints = edges.flatMap((edge, i) => [0, 1].map(u => ({ i, u,
    point: tuple(edge.pointAt(u)), tangent: unit(tuple(edge.tangentAt(u))) })));
  for (const end of endpoints) {
    const other = endpoints.filter(candidate => candidate !== end && norm(sub(candidate.point, end.point)) < 1e-6);
    if (other.length !== 1 || Math.abs(dot(other[0].tangent, end.tangent)) < 1 - 1e-7)
      throw Error('Angled draft on curved profiles requires tangent-continuous closed boundaries. Sharp curved corners still need trimming support.');
  }
}

type Sample = (u: number, distance: number) => V3;
function requireRegularWall(sample: Sample, low: number, high: number): void {
  for (let i = 0; i <= 24; i++) {
    const u = i / 24, a = Math.max(0, u - 1e-5), b = Math.min(1, u + 1e-5);
    const ruling = sub(sample(u, 1), sample(u, 0));
    const neutral = cross(sub(sample(b, 0), sample(a, 0)), ruling);
    for (const t of [low, high]) {
      const at = cross(sub(sample(b, t), sample(a, t)), ruling);
      if (dot(neutral, at) <= 1e-10 * dot(neutral, neutral)) throw Error(failure);
    }
  }
}

function fitWall(sample: Sample, low: number, high: number, direction: V3, sine: number) {
  const oc = getOC();
  for (const count of [17, 33]) {
    const points = new oc.TColgp_Array2OfPnt_2(1, count, 1, 2);
    const builder = new oc.GeomAPI_PointsToBSplineSurface_1();
    let face: Face | undefined, start: Edge | undefined, end: Edge | undefined;
    try {
      for (let i = 1; i <= count; i++) for (let j = 1; j <= 2; j++) {
        const p = new oc.gp_Pnt_3(...sample((i - 1) / (count - 1), j === 1 ? low : high));
        points.SetValue(i, j, p); p.delete();
      }
      builder.Interpolate_1(points, false);
      if (!builder.IsDone()) continue;
      const handle = builder.Surface(), surface = handle.get();
      const general = new oc.Handle_Geom_Surface_2(surface), maker = new oc.BRepBuilderAPI_MakeFace_8(general, tolerance);
      try {
        face = cast(maker.Face()) as Face;
        const edgeAt = (v: number) => {
          const curve = surface.VIso(v), edge = new oc.BRepBuilderAPI_MakeEdge_24(curve);
          try { return cast(edge.Edge()) as Edge; } finally { edge.delete(); curve.delete(); }
        };
        start = edgeAt(0); end = edgeAt(1);
        let valid = true, positionError = 0, normalError = 0;
        for (let i = 0; i < count - 1 && valid; i++) {
          const u = (i + .5) / (count - 1);
          for (const t of [low, high]) {
            const vertex = makeVertex(sample(u, t));
            try { positionError = Math.max(positionError, measureDistanceBetween(vertex, t === low ? start : end)); if (positionError > tolerance) valid = false; }
            finally { vertex.delete(); }
          }
          for (const v of [.1, .5, .9]) {
            const p = new oc.gp_Pnt_1(), a = new oc.gp_Vec_1(), b = new oc.gp_Vec_1();
            try {
              surface.D1(u, v, p, a, b);
              const n = unit(cross([a.X(), a.Y(), a.Z()], [b.X(), b.Y(), b.Z()]));
              normalError = Math.max(normalError, Math.abs(Math.abs(dot(n, direction)) - Math.abs(sine))); if (normalError > 1e-8) valid = false;
            } finally { p.delete(); a.delete(); b.delete(); }
          }
        }
        if (valid) { const result = { face, start, end }; face = undefined; start = undefined; end = undefined; return result; }
      } finally { maker.delete(); general.delete(); handle.delete(); }
    } finally { face?.delete(); start?.delete(); end?.delete(); builder.delete(); points.delete(); }
  }
  return null;
}
