import type { PartFeature } from '@aether/core/document';
import type { ConnectorCandidate, PartGeometryData } from '@aether/core/contracts';
import { nativeFaceReference } from '../viewport/planar-face-reference';

export type FeatureInputState = { feature: PartFeature; status: 'pending' | 'valid' | 'error'; message?: string };
type Reference = {
  bodyId: string;
  normal?: readonly number[];
  surfaceType?: string;
  faceAnchor?: { centerMillimeters: readonly number[]; areaSquareMillimeters: number };
  midpointMillimeters?: readonly number[];
  lengthMillimeters?: number;
  anchor?: { start: { positionMillimeters: readonly number[] }; end: { positionMillimeters: readonly number[] } };
};

/** Feature records are the selection authority. Clicking another reference must
 * not erase earlier picks, and a failed preview must not erase any of them. */
export function featureInputReferences(feature: PartFeature): Reference[] {
  const refs: Reference[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const row = value as Record<string, unknown>;
    if (typeof row.bodyId === 'string' && (row.normal || row.surfaceType || row.faceAnchor || row.midpointMillimeters || row.anchor)) {
      refs.push(row as Reference); return;
    }
    Object.values(row).forEach(visit);
  };
  visit(feature);
  return refs;
}

const near = (a: readonly number[], b: readonly number[], tolerance = 1e-6) => a.length === b.length && Math.hypot(...a.map((x, i) => x - b[i])) <= tolerance;
const edgeMatches = (ref: Reference, candidate: ConnectorCandidate) => {
  if (candidate.kind !== 'edge-midpoint') return false;
  if (ref.midpointMillimeters) return near(candidate.origin, ref.midpointMillimeters, 1e-3)
    && Math.abs((candidate.measurements?.lengthMillimeters ?? 0) - (ref.lengthMillimeters ?? 0)) <= Math.max(1e-3, (ref.lengthMillimeters ?? 0) * 1e-6);
  if (ref.anchor?.start && ref.anchor?.end) {
    const a = ref.anchor.start.positionMillimeters, b = ref.anchor.end.positionMillimeters;
    const line = candidate.polylineMillimeters;
    return line && ((near(line.slice(0, 3), a) && near(line.slice(-3), b)) || (near(line.slice(0, 3), b) && near(line.slice(-3), a)));
  }
  return false;
};

/** Resolve only exact references. Missing/ambiguous faces stay marked in the
 * dialog; never paint an unrelated nearest face as the alleged failed input. */
export function resolveFeatureInputs(feature: PartFeature, parts: readonly PartGeometryData[]) {
  return featureInputReferences(feature).flatMap(ref => {
    const part = parts.find(p => p.id.replace(/^preview:base:/, '') === ref.bodyId);
    if (!part) return [];
    if (ref.midpointMillimeters || ref.anchor?.start) {
      const edge = part.topology.flatMap(f => f.candidates).find(c => edgeMatches(ref, c));
      return edge ? [{ part, faceIds: [] as number[], edges: [edge] }] : [];
    }
    const matches = part.topology.filter(face => {
      const actual = nativeFaceReference(part.topology, face);
      if (!actual) return false;
      if (ref.surfaceType && actual.surfaceType !== ref.surfaceType) return false;
      if (ref.normal && (!actual.normal || !near(actual.normal, ref.normal))) return false;
      if (ref.faceAnchor) {
        const m = face.measurements;
        return m?.centerMillimeters && near(m.centerMillimeters, ref.faceAnchor.centerMillimeters)
          && Math.abs((m.areaSquareMillimeters ?? 0) - ref.faceAnchor.areaSquareMillimeters) <= Math.max(1e-6, ref.faceAnchor.areaSquareMillimeters * 1e-9);
      }
      return Boolean(ref.normal || ref.surfaceType);
    });
    return matches.length === 1 ? [{ part, faceIds: [matches[0].id], edges: matches[0].candidates.filter(c => c.kind === 'edge-midpoint') }] : [];
  });
}
