import type { PartDocument } from '@aether/core/document';
import type { ImportedModelData } from '@aether/core/contracts';
import { sourceFeatureForBody } from '../modeling/sketch-support';

/** The same native candidates and endpoint anchors used by viewport picking. */
export function inspectNativeTopology(document: PartDocument, model: ImportedModelData, args: Record<string, unknown>) {
  const body = model.parts.find(part => part.id === args.body_id);
  if (!body) throw Error('Body not found. Inspect the current Part for a body ID.');
  const sourceFeatureId = sourceFeatureForBody(document, body.id);
  if (!sourceFeatureId) throw Error('The body has no available source feature.');
  const offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 5);
  const candidates = body.topology.flatMap(face => face.candidates.map(candidate => ({ face, candidate })));
  const faces: { id: number; surfaceType: string; candidates: unknown[] }[] = [];
  for (const { face, candidate } of candidates.slice(offset, offset + limit)) {
    // Polylines are viewport display data; duplicate anchor payloads can exceed
    // the broker's result limit even for a modest Part. Page native candidates.
    const { polylineMillimeters: _polyline, edgeAnchor, ...compact } = candidate;
    let reference;
    if (candidate.kind === 'edge-midpoint') {
      const common = { sourceFeatureId, bodyId: body.id, label: candidate.label };
      reference = edgeAnchor
        ? { ...common, kind: 'solid-edge', anchor: edgeAnchor }
        : candidate.measurements?.lengthMillimeters
          ? { ...common, kind: 'curved-edge', midpointMillimeters: candidate.origin, lengthMillimeters: candidate.measurements.lengthMillimeters }
          : undefined;
    }
    let group = faces.find(row => row.id === face.id);
    if (!group) { group = { id: face.id, surfaceType: face.surfaceType, candidates: [] }; faces.push(group); }
    group.candidates.push({ ...compact, ...(reference ? { reference } : {}) });
  }
  return { changed: false, coordinate_units: 'millimeter', body_id: body.id, source_feature_id: sourceFeatureId,
    total_faces: body.topology.length, total_candidates: candidates.length, faces,
    next_offset: offset + limit < candidates.length ? offset + limit : null };
}
