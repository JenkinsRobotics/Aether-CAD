import { cast, getOC, isShape3D, measureVolume, type AnyShape, type Shape3D } from 'replicad';
import { dot, type V3 } from './vector';

/** Draft the longitudinal walls of a terminated extrusion. OCCT extends those
 * walls on the original stopping surfaces, so a distant construction cap never
 * makes a narrowing profile collapse before it reaches its actual limit.
 * The neutral plane stays on the authored sketch, including starting offsets.
 */
export function draftStoppedExtrusion(body: Shape3D, direction: V3, origin: V3, normal: V3, degrees: number): Shape3D {
  const oc = getOC();
  const source = body.clone().translate(0, 0, 0);
  const faces = source.faces;
  const builder = new oc.BRepOffsetAPI_DraftAngle_2(source.wrapped);
  const pull = new oc.gp_Dir_4(...direction), point = new oc.gp_Pnt_3(...origin), axis = new oc.gp_Dir_4(...normal);
  const neutral = new oc.gp_Pln_3(point, axis), progress = new oc.Message_ProgressRange_1();
  let result: AnyShape | undefined;
  try {
    let walls = 0;
    for (const face of faces) {
      const n = face.normalAt();
      const lateral = Math.abs(dot([n.x, n.y, n.z], direction)) < 1e-7;
      n.delete();
      if (!lateral) continue;
      builder.Add(face.wrapped, pull, degrees * Math.PI / 180, neutral, true);
      if (!builder.AddDone()) throw new Error('A side wall cannot be drafted against this stopping surface.');
      walls++;
    }
    if (!walls) throw new Error('The extrusion has no available side walls to draft.');
    builder.Build(progress);
    result = cast(builder.Shape());
    if (!isShape3D(result)) throw new Error('Draft did not retain a solid extrusion.');
    const check = new oc.BRepCheck_Analyzer(result.wrapped, true, false);
    try { if (!check.IsValid_2() || measureVolume(result) <= 1e-9) throw new Error('Draft collapses or intersects the extrusion before its stopping surface.'); }
    finally { check.delete(); }
    const made = result; result = undefined; return made;
  } finally {
    result?.delete(); builder.delete(); progress.delete(); neutral.delete(); axis.delete(); point.delete(); pull.delete();
    faces.forEach(face => face.delete()); source.delete();
  }
}
