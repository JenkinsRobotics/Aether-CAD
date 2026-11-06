import { cast, getOC, isShape3D, loft, measureVolume, type Shape3D, type Wire } from 'replicad';

/** Preserve successful historical lofts. Only retry invalid smooth interpolation
 * without apex constraints: a cubic surface avoids high-degree overshoot between
 * unevenly spaced stations while retaining every supplied section. */
export function sectionLoft(wires: Wire[], options: NonNullable<Parameters<typeof loft>[1]>): Shape3D {
  const original = loft(wires, options);
  const volume = measureVolume(original);
  if (options.ruled || options.startPoint || options.endPoint || (Number.isFinite(volume) && volume > 1e-9)) return original;
  original.delete();
  const oc = getOC();
  const builder = new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6);
  const progress = new oc.Message_ProgressRange_1();
  try {
    builder.SetMaxDegree(3);
    for (const wire of wires) builder.AddWire(wire.wrapped);
    builder.Build(progress);
    const candidate = cast(builder.Shape());
    let accepted = false;
    try {
      if (!isShape3D(candidate)) throw Error('Loft did not produce a closed solid.');
      const check = new oc.BRepCheck_Analyzer(candidate.wrapped, true, false);
      let valid: boolean;
      try { valid = check.IsValid_2(); } finally { check.delete(); }
      const candidateVolume = measureVolume(candidate);
      if (!valid || !Number.isFinite(candidateVolume) || candidateVolume <= 1e-9) {
        throw Error('Loft produced an inverted or degenerate solid. Adjust the sections or use a ruled loft.');
      }
      accepted = true;
      return candidate;
    } finally { if (!accepted) candidate.delete(); }
  } finally { builder.delete(); progress.delete(); }
}
