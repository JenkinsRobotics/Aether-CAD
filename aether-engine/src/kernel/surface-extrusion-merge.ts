import { cast, getOC, measureLength, type AnyShape, type Edge, type Shape3D } from 'replicad';
import { connectedSurfaceBodies, sewSurfaceExtrusion } from './surface-extrusion-outputs';

function isSolid(body: Shape3D): boolean {
  const oc = getOC(), explorer = new oc.TopExp_Explorer_2(body.wrapped, oc.TopAbs_ShapeEnum.TopAbs_SOLID as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never);
  try { return explorer.More(); } finally { explorer.delete(); }
}
function boundary(body: Shape3D): Edge[] {
  const entries: { edge: Edge; count: number }[] = [];
  for (const face of body.faces) {
    try {
      for (const edge of face.edges) {
        const existing = entries.find(item => item.edge.wrapped.IsSame(edge.wrapped));
        if (existing) { existing.count++; edge.delete(); }
        else entries.push({ edge, count: 1 });
      }
    } finally { face.delete(); }
  }
  for (const entry of entries) if (entry.count !== 1) entry.edge.delete();
  return entries.filter(entry => entry.count === 1).map(entry => entry.edge);
}
function connected(a: Shape3D, b: Shape3D): boolean {
  const oc = getOC(), first = boundary(a), second = boundary(b);
  try {
    for (const edge of first) for (const other of second) {
      const op = new oc.BRepAlgoAPI_Common_1(), args = new oc.TopTools_ListOfShape_1(), tools = new oc.TopTools_ListOfShape_1(), progress = new oc.Message_ProgressRange_1();
      let result: AnyShape | undefined;
      try {
        args.Append_1(edge.wrapped); tools.Append_1(other.wrapped);
        op.SetArguments(args); op.SetTools(tools); op.SetNonDestructive(true); op.Build(progress);
        result = cast(op.Shape());
        if (measureLength(result) > 1e-7) return true;
      } finally { result?.delete(); op.delete(); args.delete(); tools.delete(); progress.delete(); }
    }
    return false;
  } finally { first.forEach(edge => edge.delete()); second.forEach(edge => edge.delete()); }
}

/** Add joins surfaces along a shared boundary. It never thickens them or changes
 * an overlapping solid. An explicit scope must all connect to the growing sheet. */
export function mergeSurfaceExtrusion(tool: Shape3D, bodies: ReadonlyMap<string, Shape3D>, scope?: readonly string[]): { shape: Shape3D; targets: string[] } {
  const candidates = scope ? scope.map(id => {
    const body = bodies.get(id);
    if (!body || isSolid(body)) throw new Error('Surface Add requires available surface bodies in its merge scope.');
    return { id, body };
  }) : [...bodies].filter(([, body]) => !isSolid(body)).map(([id, body]) => ({ id, body }));
  let result = tool.clone();
  const targets: string[] = [];
  try {
    let changed = true;
    while (changed) {
      changed = false;
      for (const { id, body } of candidates) if (!targets.includes(id) && connected(result, body)) {
        const joined = result.fuse(body); result.delete(); result = joined;
        targets.push(id); changed = true;
      }
    }
    if (!targets.length || (scope && targets.length !== scope.length)) throw new Error('The extrusion must share an edge with every surface in its merge scope.');
    const check = new (getOC().BRepCheck_Analyzer)(result.wrapped, true, false);
    try {
      if (!check.IsValid_2() || isSolid(result)) throw new Error('Surface Add did not produce a valid sheet. Check the selected boundaries.');
    } finally { check.delete(); }
    if (scope) targets.sort((a, b) => scope.indexOf(a) - scope.indexOf(b));
    return { shape: result, targets };
  } catch (error) { result.delete(); throw error; }
}

/** Part26 Surface Add: disconnected additions retain independent target bodies.
 * A target is one identity even when an older feature created a compound sheet.
 * Inputs are borrowed; the caller owns the returned group shapes. */
export function mergeConnectedSurfaceExtrusion(tool: Shape3D, bodies: ReadonlyMap<string, Shape3D>, scope?: readonly string[]): { shape: Shape3D; targets: string[] }[] {
  const candidates = scope ? scope.map(id => {
    const body = bodies.get(id);
    if (!body || isSolid(body)) throw Error('Surface Add requires available surface bodies in its merge scope.');
    return { id, body };
  }) : [...bodies].filter(([, body]) => !isSolid(body)).map(([id, body]) => ({ id, body }));
  const sewn = sewSurfaceExtrusion([tool]);
  const outputs: { shape: Shape3D; targets: string[] }[] = [];
  let pieces: Shape3D[] = [];
  try {
    pieces = connectedSurfaceBodies(sewn);
    const shapes = [...pieces, ...candidates.map(candidate => candidate.body)];
    const parents = shapes.map((_, index) => index);
    const root = (index: number): number => {
      while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; }
      return index;
    };
    for (let a = 0; a < shapes.length; a++) for (let b = a + 1; b < shapes.length; b++) {
      if (root(a) !== root(b) && connected(shapes[a], shapes[b])) parents[root(b)] = root(a);
    }
    const groups = new Map<number, number[]>();
    shapes.forEach((_, index) => {
      const key = root(index), group = groups.get(key) ?? [];
      group.push(index); groups.set(key, group);
    });
    for (const group of groups.values()) {
      const tools = group.filter(index => index < pieces.length);
      const targets = group.filter(index => index >= pieces.length).map(index => candidates[index - pieces.length]);
      if (!tools.length) {
        if (scope) throw Error('The extrusion must share an edge with every surface in its merge scope.');
        continue;
      }
      if (!targets.length) throw Error('Every added surface must share an edge with a surface in its merge scope.');
      let result = shapes[group[0]].clone();
      try {
        for (const index of group.slice(1)) {
          const joined = result.fuse(shapes[index]); result.delete(); result = joined;
        }
        const check = new (getOC().BRepCheck_Analyzer)(result.wrapped, true, false);
        try {
          if (!check.IsValid_2() || isSolid(result)) throw Error('Surface Add did not produce a valid sheet. Check the selected boundaries.');
        } finally { check.delete(); }
        outputs.push({ shape: result, targets: targets.map(target => target.id) });
      } catch (error) { result.delete(); throw error; }
    }
    // Preserve explicit primary order, regardless of native face traversal.
    outputs.sort((a, b) => candidates.findIndex(c => c.id === a.targets[0]) - candidates.findIndex(c => c.id === b.targets[0]));
    return outputs;
  } catch (error) { outputs.forEach(output => output.shape.delete()); throw error; }
  finally { pieces.forEach(piece => piece.delete()); sewn.delete(); }
}
