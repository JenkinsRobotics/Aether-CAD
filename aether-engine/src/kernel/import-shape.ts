/** Solid imports read in-process (FreeCAD's rules from `aether_freecad/
 *  importing.py` and `cad_import.py`): STEP as saved, STL as a faceted solid
 *  in explicit source units. Surface-only or unsewn files are refused. */
import { cast, getOC, measureVolume, type Shape3D } from "replicad";

export const meshUnitScale: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

export function importSolidShape(bytes: Uint8Array, format: "step" | "stl", unitScale = 1): Shape3D {
  const oc = getOC();
  const file = `import-${Math.random().toString(36).slice(2)}.${format}`;
  // An ASCII STL shorter than its header probe: pad with spaces, as FreeCAD does.
  if (format === "stl" && bytes.length < 256 && String.fromCharCode(...bytes.slice(0, 5)) === "solid") {
    const binarySize = bytes.length >= 84 ? 84 + 50 * new DataView(bytes.buffer, bytes.byteOffset).getUint32(80, true) : -1;
    if (binarySize !== bytes.length) { const padded = new Uint8Array(256).fill(32); padded.set(bytes); bytes = padded; }
  }
  oc.FS.writeFile(`/${file}`, bytes);
  let shape: Shape3D;
  try {
    if (format === "step") {
      const reader = new oc.STEPControl_Reader_1();
      try {
        if (!reader.ReadFile(file)) throw new Error("STEP could not be read. Export a valid STEP AP214 or AP242 file.");
        const progress = new oc.Message_ProgressRange_1();
        reader.TransferRoots(progress);
        progress.delete();
        shape = cast(reader.OneShape()) as Shape3D;
      } finally { reader.delete(); }
    } else {
      const reader = new oc.StlAPI_Reader();
      const shell = new oc.TopoDS_Shell();
      try {
        if (!reader.Read(shell, file)) throw new Error("STL could not be read.");
        const unify = new oc.ShapeUpgrade_UnifySameDomain_2(shell, true, true, false);
        unify.Build();
        const builder = new oc.BRepBuilderAPI_MakeSolid_1();
        builder.Add(oc.TopoDS.Shell_1(unify.Shape()));
        shape = cast(builder.Solid()) as Shape3D;
        builder.delete(); unify.delete();
      } finally { reader.delete(); shell.delete(); }
      if (unitScale !== 1) shape = shape.scale(unitScale, [0, 0, 0]);
    }
  } finally { oc.FS.unlink(`/${file}`); }
  let volume = 0;
  try { volume = measureVolume(shape); } catch { volume = 0; }
  if (volume < 0) { shape = cast(shape.wrapped.Reversed()) as Shape3D; volume = -volume; }
  if (!(volume > 1e-9)) throw new Error("Import must contain valid solid geometry. Surface-only files need sewing/repair in the source application.");
  return shape;
}
