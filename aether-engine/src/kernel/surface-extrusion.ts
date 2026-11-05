import {
  cast, getOC, isShape3D, makeBaseBox, makeCompound,
  makeCylinder, makeSphere, measureArea, measureLength, measureShapeLinearProperties, Vector,
  type AnyShape, type Face, type Shape3D, type Wire,
} from 'replicad';
import { splitFacesByTool } from './general-fuse';
import { add, cross, dot, neg, norm, scale, sub, unit, type V3 } from './vector';

/** Resolved native inputs. Document references are resolved by the evaluator at
 * the feature's history position; this builder never guesses a missing limit. */
export interface SurfaceExtrusionEnd {
  type: 'blind' | 'through-all' | 'up-to-vertex' | 'up-to-face' | 'up-to-next' | 'up-to-part';
  distance: number;
  offset?: number;
  point?: V3;
  face?: Face;
  part?: Shape3D;
}
export interface SurfaceExtrusionOptions {
  wires: readonly Wire[];
  origin: V3;
  normal: V3;
  direction: V3;
  startingOffset?: number;
  primary: SurfaceExtrusionEnd;
  second?: SurfaceExtrusionEnd;
  limits?: readonly Shape3D[];
}
export interface SurfaceExtrusionResult {
  shape: Shape3D;
  contacts: { opposite: boolean; point: V3; direction: V3; offset: number }[];
}

const tuple = (v: Vector): V3 => { try { return [v.x, v.y, v.z]; } finally { v.delete(); } };
function linearCenter(shape: AnyShape): V3 {
  const properties = measureShapeLinearProperties(shape);
  try { return properties.centerOfMass; } finally { properties.delete(); }
}
function corners(shape: AnyShape): V3[] {
  const [a, b] = shape.boundingBox.bounds;
  return [a[0], b[0]].flatMap(x => [a[1], b[1]].flatMap(y => [a[2], b[2]].map(z => [x, y, z] as V3)));
}
const diagonal = (shape: AnyShape) => { const [a, b] = shape.boundingBox.bounds; return norm(sub(b, a)); };

/** Common must also support wires and faces, where the solid-only convenience
 * wrapper cannot be used. Non-destructive mode preserves borrowed history. */
function common(a: AnyShape, b: AnyShape): AnyShape {
  const oc = getOC(), operation = new oc.BRepAlgoAPI_Common_1();
  const arguments_ = new oc.TopTools_ListOfShape_1(), tools = new oc.TopTools_ListOfShape_1();
  const progress = new oc.Message_ProgressRange_1();
  try {
    arguments_.Append_1(a.wrapped); tools.Append_1(b.wrapped);
    operation.SetArguments(arguments_); operation.SetTools(tools); operation.SetNonDestructive(true);
    operation.Build(progress);
    return cast(operation.Shape());
  } finally { operation.delete(); arguments_.delete(); tools.delete(); progress.delete(); }
}
function commonLength(a: AnyShape, b: AnyShape): number {
  const intersection = common(a, b);
  try { return measureLength(intersection); } finally { intersection.delete(); }
}

/** A surface extrusion consists of exact native swept curves, with no caps and
 * no temporary thickness. All returned shapes belong to the caller. */
export function buildSurfaceExtrusion(options: SurfaceExtrusionOptions): SurfaceExtrusionResult {
  const oc = getOC(), owned: AnyShape[] = [];
  const own = <T extends AnyShape>(shape: T): T => { owned.push(shape); return shape; };
  let retained: Shape3D | undefined;
  const contacts: SurfaceExtrusionResult['contacts'] = [];
  const n = unit(options.normal), direction = unit(options.direction), origin = options.origin;
  if (![...n, ...direction, ...origin, options.startingOffset ?? 0].every(Number.isFinite) || Math.abs(dot(n, direction)) < 1e-7)
    throw new Error('Surface extrusion needs a finite direction that leaves the sketch plane.');
  if (!options.wires.length) throw new Error('Select sketch curves to extrude.');

  const sheet = (raw: AnyShape): Shape3D => {
    if (isShape3D(raw)) return raw;
    // One swept edge produces a Face; the body contract represents it as a shell.
    const builder = new oc.TopoDS_Builder(), shell = new oc.TopoDS_Shell();
    try { builder.MakeShell(shell); builder.Add(shell, raw.wrapped); return own(cast(shell) as Shape3D); }
    finally { builder.delete(); }
  };
  const prism = (wire: Wire, low: number, high: number, dir: V3): Shape3D => {
    if (!(high - low > 1e-9)) throw new Error('The surface extrusion must have positive depth.');
    const start = own(wire.clone().translate(...scale(dir, low)));
    const vec = new oc.gp_Vec_4(...scale(dir, high - low));
    const maker = new oc.BRepPrimAPI_MakePrism_1(start.wrapped, vec, false, true);
    try { return sheet(own(cast(maker.Shape()))); }
    finally { maker.delete(); vec.delete(); }
  };
  const halfSpace = (point: V3, keep: V3, span: number): Shape3D => {
    const box = makeBaseBox(2 * span, 2 * span, 2 * span);
    const axis = cross([0, 0, 1], keep), sine = norm(axis);
    const turned = sine < 1e-9 ? (keep[2] > 0 ? box : box.rotate(180, [0, 0, 0], [1, 0, 0]))
      : box.rotate(Math.atan2(sine, keep[2]) * 180 / Math.PI, [0, 0, 0], axis);
    return own(turned.translate(...point));
  };
  const contact = (result: Shape3D, stops: readonly Face[], opposite: boolean, dir: V3, offset: number) => {
    let length = 0, weighted: V3 = [0, 0, 0];
    for (const stop of stops) {
      const operation = new oc.BRepAlgoAPI_Section_3(result.wrapped, stop.wrapped, false);
      const progress = new oc.Message_ProgressRange_1();
      try {
        operation.Build(progress);
        const intersection = own(cast(operation.Shape()));
        for (const edge of intersection.edges) {
          try { const weight = measureLength(edge); weighted = add(weighted, scale(linearCenter(edge), weight)); length += weight; }
          finally { edge.delete(); }
        }
      } finally { operation.delete(); progress.delete(); }
    }
    if (length > 1e-8) contacts.push({ opposite, point: scale(weighted, 1 / length), direction: dir, offset });
    return length;
  };
  const valid = (result: Shape3D, start: Wire, far?: Wire) => {
    const checker = new oc.BRepCheck_Analyzer(result.wrapped, true, false);
    const length = measureLength(start), tolerance = Math.max(1e-7, length * 1e-8);
    try {
      if (!checker.IsValid_2() || measureArea(result) <= 1e-9 || Math.abs(commonLength(start, result) - length) > tolerance)
        throw new Error('The stopping surface crosses or does not preserve the complete extrusion start.');
      if (far && commonLength(far, result) > tolerance)
        throw new Error('The selected boundary does not completely terminate the surface extrusion.');
    } finally { checker.delete(); }
    return result;
  };
  try {
    const pieces: Shape3D[] = [];
    for (const [opposite, end] of [[false, options.primary], [true, options.second]] as const) {
      if (!end) continue;
      const dir = opposite ? neg(direction) : direction;
      const low = (options.startingOffset ?? 0) * (opposite ? -1 : 1), offset = end.offset ?? 0;
      if (!Number.isFinite(offset)) throw new Error('End offset must be finite.');
      const axis = dot(n, dir) > 0 ? n : neg(n), alignment = dot(axis, dir);
      const coordinate = (point: V3) => dot(sub(point, origin), axis) / alignment;
      const farthest = (shapes: readonly AnyShape[]) => Math.max(...shapes.flatMap(shape => corners(shape).map(coordinate)));
      for (const wire of options.wires) {
        const start = own(wire.clone().translate(...scale(dir, low)));
        let high: number | undefined;
        if (end.type === 'blind') {
          if (!Number.isFinite(end.distance) || end.distance <= 0) throw new Error('Enter a positive surface extrusion depth.');
          high = low + end.distance;
        } else if (end.type === 'through-all') {
          if (!options.limits?.length) throw new Error('Through all requires an earlier part or surface.');
          high = farthest(options.limits);
          if (high <= low) continue;
          high += 1;
        } else if (end.type === 'up-to-vertex') {
          if (!end.point?.every(Number.isFinite)) throw new Error('Select an available stopping point.');
          high = coordinate(end.point) - offset;
          contacts.push({ opposite, point: add(linearCenter(wire), scale(dir, high)), direction: dir, offset });
        }
        if (high !== undefined) { pieces.push(valid(prism(wire, low, high, dir), start)); continue; }
        const epsilon = Math.max(1e-6, diagonal(start) * 1e-9);
        const advancedStart = own(start.clone().translate(...scale(dir, epsilon)));
        if (end.type === 'up-to-face') {
          if (!end.face) throw new Error('Select an available stopping face.');
          const face = own(end.face.clone().translate(...scale(dir, -offset)));
          let half: Shape3D;
          if (face.geomType === 'PLANE') {
            const normal = unit(tuple(face.normalAt())), center = tuple(face.center), along = dot(normal, dir);
            if (Math.abs(along) < 1e-7) throw new Error('The stopping plane is parallel to the extrusion direction.');
            const reaches = corners(start).map(point => dot(normal, sub(center, point)) / along);
            high = low + Math.max(...reaches) + 1;
            const full = prism(wire, low, high, dir);
            const span = Math.max(...corners(full).map(point => norm(sub(point, center))), 1) * 2;
            half = halfSpace(center, along > 0 ? neg(normal) : normal, span);
            const result = valid(own(full.intersect(half)), start, own(wire.clone().translate(...scale(dir, high))));
            if (Math.abs(commonLength(advancedStart, half) - measureLength(start)) > Math.max(1e-7, measureLength(start) * 1e-8))
              throw new Error('The stopping plane crosses or lies behind the extrusion start.');
            const middle = linearCenter(wire);
            contacts.push({ opposite, point: add(middle, scale(dir, dot(normal, sub(center, middle)) / along)), direction: dir, offset });
            pieces.push(result); continue;
          }
          if (!['SPHERE', 'CYLINDRE'].includes(face.geomType)) throw new Error('This curved surface is not yet supported as a surface-extrusion limit.');
          const adaptor = new oc.BRepAdaptor_Surface_2(face.wrapped, true);
          let center: V3, normal: V3 = [0, 0, 1], radius: number;
          try {
            const curved = face.geomType === 'SPHERE' ? adaptor.Sphere() : adaptor.Cylinder();
            const point = curved.Location();
            try { center = [point.X(), point.Y(), point.Z()]; radius = curved.Radius(); }
            finally { point.delete(); }
            if (face.geomType !== 'SPHERE') { const cylinder = adaptor.Cylinder(), a = cylinder.Axis(), d = a.Direction(); normal = [d.X(), d.Y(), d.Z()]; d.delete(); a.delete(); cylinder.delete(); }
            curved.delete();
          } finally { adaptor.delete(); }
          const span = Math.max(1, norm(sub(center, linearCenter(start))) + diagonal(start) + radius) * 4;
          const primitive = own(face.geomType === 'SPHERE' ? makeSphere(radius).translate(...center)
            : makeCylinder(radius, 2 * span, sub(center, scale(normal, span)), normal));
          const edges = advancedStart.edges;
          const sample = tuple(edges[0].startPoint); edges.forEach(edge => edge.delete());
          const inside = (face.geomType === 'SPHERE' ? norm(sub(sample, center)) : norm(cross(sub(sample, center), normal))) < radius;
          half = inside ? primitive : own(own(makeBaseBox(2 * span, 2 * span, 2 * span).translate(center[0], center[1], center[2] - span)).cut(primitive));
          if (Math.abs(commonLength(advancedStart, half) - measureLength(start)) > Math.max(1e-7, measureLength(start) * 1e-8))
            throw new Error('The stopping surface crosses or lies behind the extrusion start.');
          high = farthest([half]) + 1;
          const result = own(prism(wire, low, high, dir).intersect(half));
          // Keep only faces connected to the start; an outside spherical limit
          // can otherwise leave a second, disconnected sheet on its far side.
          const faces = result.faces.map(own), connected = faces.filter(face => commonLength(start, face) > 1e-8);
          let changed = true;
          while (changed) { changed = false; for (const candidate of faces) if (!connected.includes(candidate) && connected.some(face => commonLength(face, candidate) > 1e-8)) { connected.push(candidate); changed = true; } }
          const kept = sheet(own(makeCompound(connected.map(face => face.clone()))));
          valid(kept, start, own(wire.clone().translate(...scale(dir, high))));
          const boundary = primitive.faces.map(own);
          if (contact(kept, boundary, opposite, dir, offset) < 1e-8) throw new Error('The selected surface does not stop the extrusion.');
          pieces.push(kept); continue;
        }
        const limits = end.type === 'up-to-part' ? (end.part ? [end.part] : []) : options.limits ?? [];
        if (!limits.length) throw new Error('Select an earlier stopping part or surface.');
        high = farthest(limits) + Math.abs(offset) + Math.max(1, ...limits.map(diagonal)) * 1e-5 + 1;
        if (high <= low + epsilon) throw new Error('No boundary lies beyond the extrusion start.');
        const full = prism(wire, low, high, dir);
        const stops = limits.flatMap(limit => own(limit.clone().translate(...scale(dir, -offset))).faces.map(own));
        // Split the zero-thickness sheet at the real finite boundaries. A closed
        // sphere face cannot be swept into a useful solid shadow; native face
        // splitting also retains curved contacts without inventing thickness.
        const boundaries = own(makeCompound(stops.map(face => face.clone())));
        const sourceFaces = full.faces.map(own);
        const fragments = splitFacesByTool(sourceFaces, boundaries).flat().map(own);
        const connected = fragments.filter(face => commonLength(start, face) > 1e-8);
        let changed = true;
        while (changed) {
          changed = false;
          for (const candidate of fragments) if (!connected.includes(candidate)) {
            const reachable = connected.some(face => {
              const seam = own(common(face, candidate)), length = measureLength(seam);
              if (length <= 1e-8) return false;
              return !stops.some(stop => commonLength(seam, stop) > 1e-8);
            });
            if (reachable) { connected.push(candidate); changed = true; }
          }
        }
        const result = sheet(own(makeCompound(connected.map(face => face.clone()))));
        valid(result, start, own(wire.clone().translate(...scale(dir, high))));
        if (contact(result, stops, opposite, dir, offset) < 1e-8) throw new Error('No stopping boundary meets the surface extrusion.');
        pieces.push(result);
      }
    }
    if (!pieces.length) throw new Error('Neither end reaches an existing part or surface.');
    // Fuse removes the coincident boundary between two ends without closing the
    // surface. Disconnected curve chains remain independent shells in a compound.
    retained = pieces.slice(1).reduce((all, piece) => own(all.fuse(piece)), pieces[0]);
    return { shape: retained, contacts };
  } finally { for (const shape of owned.reverse()) if (shape !== retained) shape.delete(); }
}
