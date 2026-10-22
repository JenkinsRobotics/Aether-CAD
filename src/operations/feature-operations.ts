/** Canonical feature operations: the agent's general CAD API.
 *
 * Agents author exactly what the toolbar's feature editors commit — a canonical
 * Part feature record (see `featureSchemas`, generated from the document core) —
 * through the same core history functions and validator. The live adapter then
 * runs the exact native rebuild, stale-document checks, commit and undo used for
 * every edit. Nothing here evaluates code; every result is an ordinary document.
 */
import { dependentFeatures, insertFeature, moveFeature, removeFeature, validatePartDocument, type PartDocument, type PartFeature } from '@aether/core/document';
import type { AgentTool } from '@aether/ui/AgentServices';
import { featureSchemas } from './feature-schemas.generated';

const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): AgentTool => ({
  name: `aether_cad_${name}`, description, inputSchema: { type: 'object', properties, required, additionalProperties: false },
});
const featureId = { type: 'string', maxLength: 200 };
const json = { type: 'string', maxLength: 262144 };

export const featureReadTools: AgentTool[] = [
  tool('feature_types', 'List every canonical Part feature type this editor can author (sketch, profile, extrude, revolve, sweep, loft, fillet, chamfer, shell, hole, pattern, mirror, draft, boolean, transform, plane…). Read-only.', {}),
  tool('feature_schema', 'Return the exact TypeScript declaration of one feature type and the helper types it uses, generated from the document core. Lengths are millimeters, angles degrees. Use it before feature_add/feature_update; inspect existing features for live examples. Read-only.', { type: { type: 'string', maxLength: 40 } }, ['type']),
];
export const featureEditTools: AgentTool[] = [
  tool('feature_add', 'Add one canonical feature (the same record the feature editors commit) at the rollback position. feature_json is the feature object WITHOUT "id"; include "type", "name" and every required field from feature_schema. References use existing feature and body IDs from inspect; inside run_program, pass feature_json as an object so {"$ref":"step.feature_id"} values resolve. The core validator and an exact native rebuild must pass before anything commits; one undo step.', { feature_json: json }, ['feature_json']),
  tool('feature_update', 'Change fields of an existing feature. changes_json is an object of top-level fields to replace (nested objects are replaced whole); "id" and "type" cannot change. Validated and natively rebuilt before commit; one undo step.', { feature_id: featureId, changes_json: json }, ['feature_id', 'changes_json']),
  tool('feature_delete', 'Delete one feature. Refused while other features depend on it (use feature_references to see them) — delete or repoint dependents first. One undo step.', { feature_id: featureId }, ['feature_id']),
  tool('feature_move', 'Move one feature earlier (negative delta) or later in the history. Refused when it would break references. One undo step.', { feature_id: featureId, delta: { type: 'integer', minimum: -511, maximum: 511 } }, ['feature_id', 'delta']),
];
export const featureEditToolNames = featureEditTools.map(t => t.name);

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function parseObject(text: unknown, label: string): Record<string, unknown> {
  // Programs pass an object so {"$ref":"step.feature_id"} values resolve first.
  if (object(text)) return structuredClone(text);
  if (typeof text !== 'string') throw Error(`${label} must be a JSON object string.`);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw Error(`${label} is not valid JSON.`); }
  if (!object(value)) throw Error(`${label} must be a JSON object.`);
  return value;
}
function existing(doc: PartDocument, id: unknown): PartFeature {
  const feature = typeof id === 'string' ? doc.features.find(f => f.id === id) : undefined;
  if (!feature) throw Error('Inspect the Part and choose an existing feature_id.');
  return feature;
}

export function readFeatureCatalog(name: string, args: Record<string, unknown>) {
  if (name === 'aether_cad_feature_types') return { types: Object.keys(featureSchemas) };
  const type = String(args.type ?? '');
  const declaration = featureSchemas[type];
  if (!declaration) throw Error(`Unknown feature type. Choose one of: ${Object.keys(featureSchemas).join(', ')}.`);
  return { type, units: 'millimeters and degrees', declaration };
}

/** A validated candidate document; the caller rebuilds natively and commits. */
export function prepareFeatureOperation(doc: PartDocument, name: string, args: Record<string, unknown>): { document: PartDocument; featureID: string } {
  if (name === 'aether_cad_feature_add') {
    const fields = parseObject(args.feature_json, 'feature_json');
    if ('id' in fields) throw Error('Omit "id"; the editor assigns a stable feature ID.');
    if (typeof fields.type !== 'string' || !featureSchemas[fields.type]) throw Error(`Set "type" to one of: ${Object.keys(featureSchemas).join(', ')}.`);
    const id = crypto.randomUUID();
    const feature = { suppressed: false, name: fields.type, ...fields, id } as unknown as PartFeature;
    return { document: insertFeature(doc, feature), featureID: id };
  }
  if (name === 'aether_cad_feature_update') {
    const feature = existing(doc, args.feature_id);
    const changes = parseObject(args.changes_json, 'changes_json');
    if ('id' in changes || 'type' in changes) throw Error('"id" and "type" cannot change; add a new feature instead.');
    if (!Object.keys(changes).length) throw Error('changes_json has no fields to change.');
    const next = structuredClone(doc);
    next.features = next.features.map(f => f.id === feature.id ? { ...f, ...changes } as PartFeature : f);
    validatePartDocument(next);
    return { document: next, featureID: feature.id };
  }
  if (name === 'aether_cad_feature_delete') {
    const feature = existing(doc, args.feature_id);
    const dependents = [...dependentFeatures(doc, feature.id)].filter(id => id !== feature.id);
    if (dependents.length) throw Error(`Features ${dependents.slice(0, 10).join(', ')} depend on this feature; delete or repoint them first.`);
    return { document: removeFeature(doc, feature.id), featureID: feature.id };
  }
  if (name === 'aether_cad_feature_move') {
    const feature = existing(doc, args.feature_id);
    if (!Number.isInteger(args.delta) || args.delta === 0) throw Error('delta must be a non-zero integer.');
    return { document: moveFeature(doc, feature.id, args.delta as number), featureID: feature.id };
  }
  throw Error('Unknown feature operation.');
}
