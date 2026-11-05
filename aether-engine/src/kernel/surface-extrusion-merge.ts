import { cast, getOC, measureLength, type AnyShape, type Edge, type Shape3D } from 'replicad';

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
