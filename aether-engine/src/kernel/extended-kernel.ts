/** The full OpenCascade.js build, loaded only when a document needs what the
 *  stock replicad wasm lacks: affine (non-uniform) scaling, IGES reading and
 *  half-spaces of arbitrary surfaces. It is 50 MB, so it is fetched lazily and
 *  shapes cross over as files: BREP into it, STEP back out (exact for B-rep). */
import { getOC, type AnyShape, type Shape3D } from "replicad";
import { importSolidShape } from "./import-shape";
import type { PartDocument } from "../document/index";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FullOC = any;
let full: FullOC | undefined;
let counter = 0;

export function extendedKernel(): FullOC | undefined { return full; }

/** The surface kinds the stock build cannot bound a half-space with. */
export const extendedStopSurfaces = ["cone", "torus", "bspline", "bezier", "extrusion", "revolution"];

/** True when evaluating this document would need the full build. */
export function needsExtendedKernel(document: PartDocument): boolean {
  return document.features.some((feature) => {
    if (feature.suppressed) return false;
    if (feature.type === "transform") {
      const t = feature.transform;
      return (t.kind === "scale" || t.kind === "scale-reference") && new Set(t.scaleFactors).size > 1;
    }
    if (feature.type === "import-cad") return feature.format === "iges";
    if (feature.type === "extrude") return [feature.endReference?.surfaceType, feature.secondEnd?.endReference?.surfaceType].some((kind) => kind && extendedStopSurfaces.includes(kind));
    return false;
  });
}

/** Load the full build once (browser worker or Node). `load` resolves to its module instance. */
export async function loadExtendedKernel(load: () => Promise<FullOC>): Promise<FullOC> {
  if (!full) full = await load();
  return full;
}

/** A replicad shape as a TopoDS_Shape of the full build (BREP transfer keeps topology order). */
export function toExtended(shape: AnyShape): FullOC {
  const oc = getOC(), f = full;
  if (!f) throw new Error("The extended kernel is not loaded.");
  const name = `/x-${++counter}.brep`;
  const progress = new oc.Message_ProgressRange_1();
  oc.BRepTools.Write_3(shape.wrapped, name, progress);
  progress.delete();
  const bytes = oc.FS.readFile(name);
  oc.FS.unlink(name);
  f.FS.writeFile(name, bytes);
  const result = new f.TopoDS_Shape(), builder = new f.BRep_Builder(), range = new f.Message_ProgressRange_1();
  const ok = f.BRepTools.Read_2(result, name, builder, range);
  range.delete(); builder.delete(); f.FS.unlink(name);
  if (!ok) throw new Error("Could not hand the shape to the extended kernel.");
  return result;
}

/** A full-build solid back as a replicad shape (STEP transfer; the stock build has no BREP reader). */
export function fromExtended(shape: FullOC): Shape3D {
  const f = full;
  if (!f) throw new Error("The extended kernel is not loaded.");
  const name = `/x-${++counter}.step`;
  const writer = new f.STEPControl_Writer_1();
  f.Interface_Static.SetIVal("write.step.schema", 5);
  writer.Model(true).delete();
  const progress = new f.Message_ProgressRange_1();
  writer.Transfer(shape, f.STEPControl_StepModelType.STEPControl_AsIs, true, progress);
  const done = writer.Write(name);
  writer.delete(); progress.delete();
  if (done !== f.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error("The extended kernel could not hand its result back.");
  const bytes = f.FS.readFile(name);
  f.FS.unlink(name);
  return importSolidShape(bytes, "step");
}

/** Every solid of a full-build shape, each shell closed into a solid when the shape holds only faces. */
export function extendedSolids(shape: FullOC): FullOC {
  const f = full;
  const count = (kind: string) => { const explorer = new f.TopExp_Explorer_2(shape, f.TopAbs_ShapeEnum[kind], f.TopAbs_ShapeEnum.TopAbs_SHAPE); let n = 0; while (explorer.More()) { n++; explorer.Next(); } explorer.delete(); return n; };
  if (count("TopAbs_SOLID") > 0) return shape;
  if (count("TopAbs_FACE") === 0) throw new Error("Import must contain valid solid geometry. Surface-only files need sewing/repair in the source application.");
  // Faces only (IGES): sew them, then close each shell into a solid.
  const sewing = new f.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
  sewing.Load(shape);
  const progress = new f.Message_ProgressRange_1();
  sewing.Perform(progress);
  const sewn = sewing.SewedShape();
  progress.delete(); sewing.delete();
  const builder = new f.BRep_Builder(), compound = new f.TopoDS_Compound();
  builder.MakeCompound(compound);
  const shells = new f.TopExp_Explorer_2(sewn, f.TopAbs_ShapeEnum.TopAbs_SHELL, f.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let solids = 0;
  while (shells.More()) {
    const shell = f.TopoDS.Shell_1(shells.Current());
    if (!f.BRep_Tool.IsClosed_1(shell)) { shells.delete(); builder.delete(); throw new Error("Geometry contains an open shell. Import a mesh as a reference or repair the source."); }
    const maker = new f.BRepBuilderAPI_MakeSolid_3(shell);
    builder.Add(compound, maker.Solid());
    maker.delete(); solids++;
    shells.Next();
  }
  shells.delete(); builder.delete();
  if (!solids) throw new Error("Geometry could not be sewn into closed shells. Import a mesh as a reference or repair the source.");
  return compound;
}
