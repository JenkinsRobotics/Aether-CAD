import type { SolidEdgeReference } from '../document/solid-edge-reference';
import { type Shape3D } from 'replicad';
import { vertexAnchorsOf } from './part-geometry';
import type { V3 } from './vector';

/** Resolve actual native membership, never a nearest edge or traversal index.
 * An unchanged supporting line can retain a straight edge when an extrusion
 * changes its length and otherwise identical vertex signatures are ambiguous. */
export function straightEdgeMidpoint(body: Shape3D, reference: SolidEdgeReference): V3 {
  const anchors = [...vertexAnchorsOf(body).values()];
  const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((x, i) => x - b[i]));
  const old = [reference.anchor.start, reference.anchor.end];
  const resolved = old.map(anchor => {
    const candidates = anchors.filter(a => a.signature === anchor.signature);
    if (candidates.length === 1) return candidates[0];
    const exact = candidates.filter(a => distance(a.positionMillimeters, anchor.positionMillimeters) < 1e-6);
    return exact.length === 1 ? exact[0] : undefined;
  });
  const origin = old[0].positionMillimeters;
  const delta = old[1].positionMillimeters.map((x, i) => x - origin[i]);
  const length = Math.hypot(...delta), direction = delta.map(x => x / length);
  const onLine = (point: readonly number[]) => {
    const relative = point.map((x, i) => x - origin[i]);
    const along = relative.reduce((sum, x, i) => sum + x * direction[i], 0);
    return Math.hypot(...relative.map((x, i) => x - along * direction[i])) < 1e-6;
  };
  const edges = body.edges, matches: V3[] = [];
  try {
    for (const edge of edges) {
      if (edge.geomType !== 'LINE') continue;
      const a = edge.startPoint, b = edge.endPoint;
      const points: V3[] = [[a.x, a.y, a.z], [b.x, b.y, b.z]];
      a.delete(); b.delete();
      const ends = points.map(point => anchors.find(anchor => distance(anchor.positionMillimeters, point) < 1e-6));
      if (!ends.every(Boolean)) continue;
      const signaturesMatch = (ends[0]!.signature === old[0].signature && ends[1]!.signature === old[1].signature)
        || (ends[1]!.signature === old[0].signature && ends[0]!.signature === old[1].signature);
      if (!signaturesMatch) continue;
      const exactPair = resolved.every(Boolean) && (
        (distance(points[0], resolved[0]!.positionMillimeters) < 1e-6 && distance(points[1], resolved[1]!.positionMillimeters) < 1e-6)
        || (distance(points[1], resolved[0]!.positionMillimeters) < 1e-6 && distance(points[0], resolved[1]!.positionMillimeters) < 1e-6));
      if (!exactPair && !(length > 1e-9 && points.every(onLine))) continue;
      const middle = edge.pointAt(.5);
      matches.push([middle.x, middle.y, middle.z]); middle.delete();
    }
  } finally { edges.forEach(edge => edge.delete()); }
  if (matches.length !== 1) throw Error(`${reference.label} changed or is ambiguous. Reselect the edge.`);
  return matches[0];
}
