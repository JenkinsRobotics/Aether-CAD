import type { BRepFilletAPI_MakeChamfer, BRepFilletAPI_MakeFillet, ChFi3d_FilletShape } from 'replicad-opencascadejs';
import { cast, EdgeFinder, getOC, isShape3D, type AnyShape, type Edge, type Shape3D } from 'replicad';
import type { V3 } from '../vector';

export function validFinishSolid(shape: Shape3D): boolean {
  const oc = getOC(), check = new oc.BRepCheck_Analyzer(shape.wrapped, true, false);
  try { return check.IsValid_2(); } finally { check.delete(); }
}

/** Adds one requested edge to a native fillet/chamfer builder on `shape`; `point` is the
 * edge's original midpoint (still on the edge after an earlier pass trims its ends). */
export type AddFinishEdge = (builder: BRepFilletAPI_MakeFillet | BRepFilletAPI_MakeChamfer, edge: Edge, point: V3, shape: Shape3D) => void;

/** Retry a failed fillet/chamfer corner without changing the requested edges
 * or sizes. OCCT's simultaneous corner solver is order-sensitive. First seed
 * straight edges, then try curved and straight boundaries in two native passes.
 * Each retained edge must still contain its exact original midpoint; if a pass
 * consumes another requested edge, refuse rather than silently omitting it.
 */
export function recoverEdgeFinish(kind: 'fillet' | 'chamfer', body: Shape3D, points: readonly V3[], add: AddFinishEdge): Shape3D {
  const source = body.clone().translate(0, 0, 0);
  let selected: Edge[] = [];
  try {
    selected = new EdgeFinder().either(points.map(p => (f: EdgeFinder) => f.containsPoint(p))).find(source);
    if (selected.length < 2) throw new Error('No multi-edge corner to recover.');
    const oc = getOC(), builderOn = (shape: Shape3D) => kind === 'fillet'
      ? new oc.BRepFilletAPI_MakeFillet(shape.wrapped, oc.ChFi3d_FilletShape.ChFi3d_Rational as ChFi3d_FilletShape)
      : new oc.BRepFilletAPI_MakeChamfer(shape.wrapped);
    const midpoint = (edge: Edge): V3 => { const p = edge.pointAt(.5); try { return [p.x, p.y, p.z]; } finally { p.delete(); } };
    const ordered = [...selected].sort((a, b) => Number(b.geomType === 'LINE') - Number(a.geomType === 'LINE') || a.length - b.length);
    const builder = builderOn(source), progress = new oc.Message_ProgressRange_1();
    let trial: AnyShape | undefined;
    try {
      for (const edge of ordered) add(builder, edge, midpoint(edge), source);
      builder.Build(progress);
      trial = cast(builder.Shape());
      if (isShape3D(trial) && validFinishSolid(trial)) { const made = trial; trial = undefined; return made; }
    } catch { /* Try the same complete edge set in two native passes below. */ }
    finally { trial?.delete(); builder.delete(); progress.delete(); }

    const groups = [selected.filter(e => e.geomType !== 'LINE'), selected.filter(e => e.geomType === 'LINE')].map(edges => edges.map(midpoint));
    if (groups.some(group => !group.length)) throw new Error('The selected corner could not be built.');
    // A copied topology keeps unsuccessful trials out of the retained history.
    let result = body.clone().translate(0, 0, 0);
    try {
      for (const group of groups) {
        const edges: Edge[] = [], pass = builderOn(result), passProgress = new oc.Message_ProgressRange_1();
        try {
          for (const point of group) {
            const hits = new EdgeFinder().containsPoint(point).find(result);
            if (hits.length !== 1) { hits.forEach(e => e.delete()); throw new Error('An earlier finish consumed another selected edge.'); }
            edges.push(hits[0]); add(pass, hits[0], point, result);
          }
          pass.Build(passProgress);
          const next = cast(pass.Shape());
          if (!isShape3D(next)) { next.delete(); throw new Error('The selected corner did not produce a solid.'); }
          result.delete(); result = next;
          if (!validFinishSolid(result)) throw new Error('The selected corner produces an invalid solid.');
        } finally { edges.forEach(e => e.delete()); pass.delete(); passProgress.delete(); }
      }
      return result;
    } catch (error) { result.delete(); throw error; }
  } finally { selected.forEach(edge => edge.delete()); source.delete(); }
}
