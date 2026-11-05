import type { Face, Shape3D } from 'replicad';
import type { ExtrusionDirectionReference, ExtrusionPointReference } from '../document/index';
import { deleteAfterVectorTuple } from '../geometry/index';
import { norm, sub, unit, type V3 } from './vector';
import { nativeFaceAxisDirection } from './native-face-axis';

type Context = {
  sketchLine: (ref: Extract<ExtrusionDirectionReference, { kind: 'sketch-line' }>, error: string) => [V3, V3];
  axis: (sourceId: string) => V3;
  bodyAt: (sourceId: string, bodyId: string) => Shape3D | undefined | null;
  point: (ref: ExtrusionPointReference) => V3;
  face: (body: Shape3D, ref: Extract<ExtrusionDirectionReference, { kind: 'face-axis' }>, label: string) => Face;
};

export function resolveExtrusionDirection(ref: ExtrusionDirectionReference, context: Context): V3 {
  if (ref.kind === 'axis') return unit(context.axis(ref.sourceFeatureId));
  if (ref.kind === 'face-axis') {
    const body = context.bodyAt(ref.sourceFeatureId, ref.bodyId);
    if (!body) throw Error('Extrusion axis face source is unavailable. Reselect an earlier native face.');
    const face = context.face(body, ref, 'Extrusion axis');
    try { return nativeFaceAxisDirection(face); }
    finally { face.delete(); }
  }
  let from: V3, to: V3;
  if (ref.kind === 'sketch-line') {
    [from, to] = context.sketchLine(ref, 'Extrusion direction line is unavailable or no longer straight. Reselect it.');
  } else {
    const body = context.bodyAt(ref.sourceFeatureId, ref.bodyId);
    if (!body) throw Error('Extrusion direction edge source is unavailable. Reselect an earlier native edge.');
    const at = (anchor: typeof ref.anchor.start) => context.point({ ...ref, kind: 'solid-vertex', anchor });
    from = at(ref.anchor.start); to = at(ref.anchor.end);
    // Anchors identify endpoints. They must still belong to one straight edge,
    // not a body diagonal or a curved edge with the same endpoints.
    const edges = body.edges;
    try {
      const same = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((v, i) => v - b[i])) < 1e-6;
      const matches = edges.filter(edge => {
        if (edge.geomType !== 'LINE') return false;
        const a = deleteAfterVectorTuple(edge.startPoint), b = deleteAfterVectorTuple(edge.endPoint);
        return (same(a, from) && same(b, to)) || (same(b, from) && same(a, to));
      });
      if (matches.length !== 1) throw Error('Extrusion direction is no longer one native straight edge. Reselect it.');
    } finally { edges.forEach(edge => edge.delete()); }
  }
  const along = sub(to, from);
  if (!along.every(Number.isFinite) || norm(along) < 1e-9) throw Error('Extrusion direction must have finite nonzero length.');
  return unit(along);
}
