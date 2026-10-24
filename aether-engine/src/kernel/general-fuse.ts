/** Splitting faces by a tool with OCCT's general fuse (BRepAlgoAPI_BuilderAlgo), the one
 *  splitting algorithm in the single wasm build (BRepAlgoAPI_Splitter and BRepFeat_SplitShape
 *  are absent, and sheet-against-solid Common/Cut return nothing). */
import { cast, getOC, type AnyShape, type Face } from "replicad";

type V3 = [number, number, number];
/** A square face on a plane, `size` from its origin each way: a cutting tool. Caller deletes it. */
export function planeToolFace(origin: V3, normal: V3, size: number): AnyShape {
  const o = getOC() as any;
  const p = new o.gp_Pnt_3(...origin), d = new o.gp_Dir_4(...normal), ax = new o.gp_Ax3_4(p, d), pln = new o.gp_Pln_2(ax);
  const maker = new o.BRepBuilderAPI_MakeFace_9(pln, -size, size, -size, size);
  try { return cast(maker.Face()); } finally { maker.delete(); pln.delete(); ax.delete(); d.delete(); p.delete(); }
}
/** Each face's pieces after the tool cuts it (the face itself when nothing crosses it). */
export function splitFacesByTool(faces: readonly Face[], tool: AnyShape): Face[][] {
  const o = getOC() as any;
  const args = new o.TopTools_ListOfShape_1();
  for (const f of faces) args.Append_1(f.wrapped);
  args.Append_1(tool.wrapped);
  const fuse = new o.BRepAlgoAPI_BuilderAlgo_1(), progress = new o.Message_ProgressRange_1();
  try {
    fuse.SetArguments(args); fuse.Build(progress);
    if (!fuse.IsDone()) throw new Error("The faces could not be split.");
    return faces.map((f) => {
      const copy = new o.TopTools_ListOfShape_1();
      copy.Assign(fuse.Modified(f.wrapped));
      const pieces: Face[] = [];
      while (copy.Size() > 0) { pieces.push(cast(copy.First_1()) as Face); copy.RemoveFirst(); }
      copy.delete();
      return pieces.length ? pieces : [f.clone() as Face];
    });
  } finally { progress.delete(); fuse.delete(); args.delete(); }
}
