import { cast, getOC, isShape3D, Face, measureArea, type AnyShape, type Edge, type Shape3D } from 'replicad';
import { sha256Hex } from './sha256';

/** Sew only coincident native boundaries, without closing intentional small gaps.
 * Input shapes are borrowed. The returned shape belongs to the caller. */
export function sewSurfaceExtrusion(shapes: readonly Shape3D[]): Shape3D {
  if (shapes.length === 1) return shapes[0].clone();
  const oc = getOC(), sewing = new oc.BRepBuilderAPI_Sewing(1e-7, true, true, true, false);
  const progress = new oc.Message_ProgressRange_1();
  try {
    shapes.forEach(shape => sewing.Add(shape.wrapped));
    sewing.Perform(progress);
    const shape = cast(sewing.SewedShape());
    if (isShape3D(shape)) return shape;
    const builder = new oc.TopoDS_Builder(), shell = new oc.TopoDS_Shell();
    try { builder.MakeShell(shell); builder.Add(shell, shape.wrapped); return cast(shell) as Shape3D; }
    finally { builder.delete(); shape.delete(); }
  } finally { sewing.delete(); progress.delete(); }
}

/** Split the actual native surface by shared edges, never by mesh vertices or
 * explorer order. Point contact alone does not join two surface bodies.
 * Input is borrowed; the caller owns every returned shell. */
export function connectedSurfaceBodies(shape: Shape3D): Shape3D[] {
  const oc = getOC(), faces = shape.faces, parents = faces.map((_, index) => index);
  const edges = new Map<number, { edge: Edge; face: number }[]>();
  const outputs: Shape3D[] = [];
  const root = (index: number): number => {
    while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; }
    return index;
  };
  try {
    faces.forEach((face, index) => {
      for (const edge of face.edges) {
        const bucket = edges.get(edge.hashCode) ?? [];
        const shared = bucket.find(other => other.edge.wrapped.IsSame(edge.wrapped));
        if (shared) { parents[root(index)] = root(shared.face); edge.delete(); }
        else { bucket.push({ edge, face: index }); edges.set(edge.hashCode, bucket); }
      }
    });
    const groups = new Map<number, number[]>();
    faces.forEach((_, index) => { const key = root(index); const group = groups.get(key) ?? []; group.push(index); groups.set(key, group); });
    for (const group of groups.values()) {
      const builder = new oc.TopoDS_Builder(), shell = new oc.TopoDS_Shell();
      try {
        builder.MakeShell(shell);
        group.forEach(index => builder.Add(shell, faces[index].wrapped));
        const output = cast(shell) as Shape3D;
        outputs.push(output);
        const check = new oc.BRepCheck_Analyzer(output.wrapped, true, false);
        try { if (!check.IsValid_2() || measureArea(output) <= 1e-9) throw Error('Surface extrusion produced an invalid connected sheet.'); }
        finally { check.delete(); }
      } finally { builder.delete(); }
    }
    if (!outputs.length) throw Error('Surface extrusion produced no sheets.');
    return outputs;
  } catch (error) { outputs.forEach(output => output.delete()); throw error; }
  finally {
    faces.forEach(face => face.delete());
    edges.forEach(bucket => bucket.forEach(({ edge }) => edge.delete()));
  }
}

function sharedArea(a: AnyShape, b: AnyShape): number {
  const oc = getOC(), operation = new oc.BRepAlgoAPI_Common_1();
  const arguments_ = new oc.TopTools_ListOfShape_1(), tools = new oc.TopTools_ListOfShape_1();
  const progress = new oc.Message_ProgressRange_1();
  try {
    arguments_.Append_1(a.wrapped); tools.Append_1(b.wrapped);
    operation.SetArguments(arguments_); operation.SetTools(tools); operation.SetNonDestructive(true);
    operation.Build(progress);
    const common = cast(operation.Shape());
    try { return common instanceof Face || isShape3D(common) ? measureArea(common) : 0; } finally { common.delete(); }
  } finally { operation.delete(); arguments_.delete(); tools.delete(); progress.delete(); }
}

/** Source identities survive dimension changes, source order and removal of a
 * different curve. Ambiguous splits fail instead of rebinding downstream work.
 * All source shapes are borrowed; only the returned output shells are owned. */
export function surfaceExtrusionOutputs(shape: Shape3D, sources: readonly { key: string; shape: Shape3D }[]): { key: string; shape: Shape3D }[] {
  const outputs = connectedSurfaceBodies(shape);
  try {
    const named = outputs.map(output => {
      const identities = sources.length === 1 ? [sources[0].key] : sources.filter(source => sharedArea(output, source.shape) > 1e-9).map(source => source.key);
      if (!identities.length) throw Error('Could not identify a surface extrusion output.');
      return { key: sha256Hex(JSON.stringify([...new Set(identities)].sort())).slice(0, 24), shape: output };
    });
    if (new Set(named.map(output => output.key)).size !== named.length)
      throw Error('A sketch curve splits into ambiguous surface bodies. Use distinct sketch curves.');
    return named;
  } catch (error) { outputs.forEach(output => output.delete()); throw error; }
}
