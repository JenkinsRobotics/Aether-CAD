import { featureDependencies, rollbackPosition, type PartDocument } from '@aether/core/document';

/** Read the canonical feature graph, not a second interpretation of body/face IDs.
 * Pagination bounds agent responses even when a feature has many dependents. */
export function inspectFeatureReferences(doc: PartDocument, args: Record<string, unknown>) {
  const feature = doc.features.find(feature => feature.id === args.feature_id);
  if (!feature) throw Error('Inspect the Part and choose an existing feature_id.');
  const direction = args.direction ?? 'inputs';
  if (direction !== 'inputs' && direction !== 'dependents') throw Error('Choose inputs or dependents.');
  const offset = args.offset ?? 0, limit = args.limit ?? 25;
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 ||
      typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw Error('Use offset >= 0 and limit 1–50.');
  const graph = featureDependencies(doc, true);
  const ids = direction === 'inputs' ? graph.get(feature.id) ?? []
    : [...graph].filter(([, inputs]) => inputs.includes(feature.id)).map(([id]) => id);
  return { document_id: doc.documentId, feature_id: feature.id, direction, transitive: false,
    reference_kind: 'feature-history', topology_verified: false, total: ids.length, offset,
    references: ids.slice(offset, offset + limit).map(id => {
      const index = doc.features.findIndex(item => item.id === id);
      const source = doc.features[index];
      return { id, exists: Boolean(source), ...(source ? { name: source.name, type: source.type,
        suppressed: source.suppressed, rolled_back: index >= rollbackPosition(doc) } : {}) };
    }), next_offset: offset + limit < ids.length ? offset + limit : null };
}
