/** replicad's fuse / cut / intersect construct the OCCT operation with the
 *  two-shape constructor, which already performs the boolean, and then call
 *  Build again: every boolean ran twice. The same operations, built once, with
 *  replicad's result simplification and glue options kept. Importing this
 *  module applies the override to every 3D shape. */
import { _3DShape, cast, getOC, isShape3D, type Shape3D } from "replicad";

type Glue = { optimisation?: "none" | "commonFace" | "sameFace" };

function once(kind: "fuse" | "cut" | "intersect", a: Shape3D, b: Shape3D, options: Glue = {}): Shape3D {
  const oc = getOC();
  const op = kind === "fuse" ? new oc.BRepAlgoAPI_Fuse_1() : kind === "cut" ? new oc.BRepAlgoAPI_Cut_1() : new oc.BRepAlgoAPI_Common_1();
  const arguments_ = new oc.TopTools_ListOfShape_1(), tools = new oc.TopTools_ListOfShape_1();
  arguments_.Append_1(a.wrapped); tools.Append_1(b.wrapped);
  op.SetArguments(arguments_); op.SetTools(tools);
  // History and previews share immutable native inputs. OCCT's default mode
  // updates their subshapes in place, invalidating cached geometry/snapshots.
  op.SetNonDestructive(true);
  if (options.optimisation === "commonFace") op.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueShift as never);
  if (options.optimisation === "sameFace") op.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueFull as never);
  const progress = new oc.Message_ProgressRange_1();
  try {
    op.Build(progress);
    // Unification in the shipped kernel can still add curves to shared tool
    // faces even in safe-input mode. Isolate its result first; a plain clone
    // only copies the TopoDS wrapper and still shares the underlying TShape.
    const raw = cast(op.Shape());
    let isolated: typeof raw;
    try { isolated = raw.clone().translate(0, 0, 0); }
    finally { raw.delete(); }
    const unifier = new oc.ShapeUpgrade_UnifySameDomain_2(isolated.wrapped, true, true, false);
    try {
      unifier.SetSafeInputMode(true);
      unifier.SetAngularTolerance(1e-3);
      unifier.Build();
      const result = cast(unifier.Shape());
      if (!isShape3D(result)) { result.delete(); throw new Error(`Could not ${kind} as a 3d shape`); }
      return result;
    } finally { unifier.delete(); isolated.delete(); }
  } finally { op.delete(); arguments_.delete(); tools.delete(); progress.delete(); }
}

const prototype = _3DShape.prototype as unknown as Record<string, unknown>;
prototype.fuse = function (this: Shape3D, other: Shape3D, options?: Glue) { return once("fuse", this, other, options); };
prototype.cut = function (this: Shape3D, tool: Shape3D, options?: Glue) { return once("cut", this, tool, options); };
prototype.intersect = function (this: Shape3D, tool: Shape3D) { return once("intersect", this, tool); };
