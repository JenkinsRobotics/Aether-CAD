import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { availableBodies, createRectanglePartDocument, serializePartDocument } from '@aether/core/document';
import { prepareFeatureOperation, readFeatureCatalog } from './feature-operations';
import { cadAgentTools, preparePartEdit } from '../automation/live-commands';
import { executeProgram } from '../ai/program';
// @ts-expect-error -- plain ESM build script without declarations
import { OUTPUT, render } from '../../scripts/generate-feature-schemas.mjs';

const fixture = () => createRectanglePartDocument('Plate', { widthMillimeters: 40, heightMillimeters: 20, depthMillimeters: 5 },
  { documentId: 'doc', sketchId: 'sketch', extrudeId: 'pad' });

it('keeps the generated feature schemas in step with the document core', () => {
  expect(readFileSync(OUTPUT, 'utf8')).toBe(render());
});

it('discovers every canonical feature type and its exact declaration', () => {
  const { types } = readFeatureCatalog('aether_cad_feature_types', {}) as { types: string[] };
  for (const type of ['sketch', 'profile', 'extrude', 'revolve', 'sweep', 'loft', 'fillet', 'chamfer', 'shell', 'hole', 'pattern', 'mirror', 'draft', 'boolean', 'transform', 'plane']) expect(types).toContain(type);
  expect((readFeatureCatalog('aether_cad_feature_schema', { type: 'fillet' }) as { declaration: string }).declaration).toContain('radiusMillimeters');
  expect(() => readFeatureCatalog('aether_cad_feature_schema', { type: 'nope' })).toThrow(/Unknown feature type/);
  expect(cadAgentTools.map(t => t.name)).toEqual(expect.arrayContaining(['aether_cad_feature_add', 'aether_cad_feature_update', 'aether_cad_feature_delete', 'aether_cad_feature_move', 'aether_cad_feature_schema']));
});

it('exposes Surface extrusion inherited extents to agents and accepts their canonical inputs', () => {
  const { declaration } = readFeatureCatalog('aether_cad_feature_schema', { type: 'surface-extrude' }) as { declaration: string };
  for (const field of ['interface ExtrudeFeature', 'startingReference', 'directionVector', 'secondEnd', 'endPartId', 'targetBodyIds']) {
    expect(declaration).toContain(field);
  }
  const doc = fixture();
  const { document } = prepareFeatureOperation(doc, 'aether_cad_feature_add', { feature_json: JSON.stringify({
    type: 'surface-extrude', name: 'Sheet', operation: 'new', profileFeatureId: 'sketch',
    distanceMillimeters: 5, startingOffsetMillimeters: -2, directionVector: [0, .6, .8],
    secondEnd: { endType: 'blind', distanceMillimeters: 3 },
  }) });
  expect(document.features.at(-1)).toMatchObject({ type: 'surface-extrude', separateBodies: true, outputProfileId: 'sketch', startingOffsetMillimeters: -2,
    secondEnd: { endType: 'blind', distanceMillimeters: 3 } });
});

it('adds a canonical feature through the core validator without touching the source document', () => {
  const doc = fixture(), before = serializePartDocument(doc), body = availableBodies(doc)[0].id;
  const { document, featureID } = preparePartEdit(doc, 'aether_cad_feature_add', { feature_json: JSON.stringify({ type: 'fillet', name: 'Round edges', radiusMillimeters: 1, targetBodyId: body }) });
  expect(document.features.at(-1)).toMatchObject({ id: featureID, type: 'fillet', radiusMillimeters: 1, suppressed: false });
  expect(serializePartDocument(doc)).toBe(before);
  expect(() => prepareFeatureOperation(doc, 'aether_cad_feature_add', { feature_json: JSON.stringify({ id: 'mine', type: 'fillet' }) })).toThrow(/Omit "id"/);
  expect(() => prepareFeatureOperation(doc, 'aether_cad_feature_add', { feature_json: '{"type":"warp-drive"}' })).toThrow(/Set "type"/);
  // The core validator's own message reaches the agent; references to missing bodies are left to the native rebuild.
  expect(() => prepareFeatureOperation(doc, 'aether_cad_feature_add', { feature_json: JSON.stringify({ type: 'extrude', name: 'Bad', profileFeatureId: 'sketch', distanceMillimeters: -5, operation: 'new' }) })).toThrow(/greater than zero/);
});

it('updates, deletes and moves features with identity and dependency guards', () => {
  const doc = fixture();
  const updated = prepareFeatureOperation(doc, 'aether_cad_feature_update', { feature_id: 'pad', changes_json: '{"distanceMillimeters":12}' });
  expect(updated.document.features.find(f => f.id === 'pad')).toMatchObject({ distanceMillimeters: 12 });
  expect(() => prepareFeatureOperation(doc, 'aether_cad_feature_update', { feature_id: 'pad', changes_json: '{"type":"revolve"}' })).toThrow(/cannot change/);
  expect(() => prepareFeatureOperation(doc, 'aether_cad_feature_delete', { feature_id: 'sketch' })).toThrow(/depend on this feature/);
  expect(prepareFeatureOperation(doc, 'aether_cad_feature_delete', { feature_id: 'pad' }).document.features.map(f => f.id)).toEqual(['sketch']);
  expect(() => prepareFeatureOperation(doc, 'aether_cad_feature_move', { feature_id: 'pad', delta: -1 })).toThrow();
});

it('pins legacy extrusion output identity before changing its primary selected sketch', () => {
  const doc = fixture();
  const second = { ...structuredClone(doc.features[0]), id: 'second', name: 'Second sketch' };
  doc.features.splice(1, 0, second);
  Object.assign(doc.features.at(-1)!, { separateBodies: true });
  const updated = prepareFeatureOperation(doc, 'aether_cad_feature_update', { feature_id: 'pad',
    changes_json: JSON.stringify({ profileFeatureId: 'second', profileSelections: [{ profileFeatureId: 'second' }] }) });
  expect(updated.document.features.at(-1)).toMatchObject({ profileFeatureId: 'second', outputProfileId: 'sketch' });
  expect(() => prepareFeatureOperation(updated.document, 'aether_cad_feature_update', {
    feature_id: 'pad', changes_json: '{"outputProfileId":"second"}',
  })).toThrow(/identity.*cannot be changed/);
});

it('composes canonical features in one transactional program with step references', async () => {
  const doc = fixture();
  const program = JSON.stringify({ version: 1, steps: [
    { id: 'outline', tool: 'aether_cad_sketch_rectangle', arguments: { plane: 'XY', x_mm: 0, y_mm: 0, width_mm: 10, height_mm: 10, offset_mm: 5 } },
    { id: 'boss', tool: 'aether_cad_feature_add', arguments: { feature_json: { type: 'extrude', name: 'Boss', profileFeatureId: { $ref: 'outline.feature_id' }, distanceMillimeters: 3, operation: 'new', endType: 'blind' } } },
  ] });
  const result = await executeProgram(doc, program, async candidate => candidate);
  const boss = result.document.features.find(f => f.name === 'Boss');
  expect(boss).toMatchObject({ type: 'extrude', profileFeatureId: result.references.outline.feature_id });
  expect(doc.features).toHaveLength(2);
});
