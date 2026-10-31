/** Exact shapes as OCCT binary B-rep (BinTools), for the persisted replay cache. Geometry,
 *  topology order and any face triangulation round-trip; nothing is approximated. */
import { cast, getOC, isShape3D, type Shape3D } from "replicad";

let counter = 0;

export function writeBrep(shape: Shape3D): Uint8Array {
  const oc = getOC(), name = `/replay-${++counter}.brep`, range = new oc.Message_ProgressRange_1();
  try {
    if (!oc.BinTools.Write_3(shape.wrapped, name, range)) throw new Error("Could not write the shape.");
    return oc.FS.readFile(name);
  } finally {
    range.delete();
    try { oc.FS.unlink(name); } catch { /* never written */ }
  }
}

export function readBrep(bytes: Uint8Array): Shape3D {
  const oc = getOC(), name = `/replay-${++counter}.brep`, range = new oc.Message_ProgressRange_1(), raw = new oc.TopoDS_Shape();
  try {
    oc.FS.writeFile(name, bytes);
    if (!oc.BinTools.Read_2(raw, name, range) || raw.IsNull()) throw new Error("Damaged shape data.");
    const shape = cast(raw);
    if (!isShape3D(shape)) { shape.delete(); throw new Error("Damaged shape data."); }
    return shape;
  } finally {
    range.delete(); raw.delete();
    try { oc.FS.unlink(name); } catch { /* never written */ }
  }
}
