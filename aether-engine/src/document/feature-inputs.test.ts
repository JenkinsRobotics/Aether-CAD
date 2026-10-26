import { describe, expect, it } from 'vitest';
import { createRectanglePartDocument, validatePartDocument, type PartFeature } from './part-document';
import { bodyIDForFeature, dependentFeatures, featureDependencies, removeFeature, setFeatureSuppressed } from './feature-history';
import { featureInputDependencies } from './feature-inputs';
import { featureReferenceErrors } from './feature-errors';
import { parsePartDocument, serializePartDocument } from './part-serialization';

const base = { name: 'Reference fixture', suppressed: false };
const fixture = () => createRectanglePartDocument('Foundation', {
  widthMillimeters: 20, heightMillimeters: 10, depthMillimeters: 5,
}, { documentId: 'doc', sketchId: 'sketch', extrudeId: 'pad' });
const plane: PartFeature = { ...base, id: 'plane', type: 'plane', plane: 'XY', offsetMillimeters: 0 };
const axis: PartFeature = { ...base, id: 'axis', type: 'axis', definition: {
  method: 'two-planes', references: [{ kind: 'feature', featureId: 'plane' }, { kind: 'principal', plane: 'XZ' }],
} };
const pattern: PartFeature = { ...base, id: 'pattern', type: 'pattern', sourceFeatureId: 'pad',
  patternType: 'polar', axis: 'Z', axisReference: { kind: 'feature', featureId: 'axis' }, count: 3, angleDegrees: 120, reversed: false };

describe('reference identity across history operations', () => {
  it('suppresses the construction-plane → axis → pattern chain and restores prerequisites', () => {
    const doc = fixture(); doc.features.push(plane, axis, pattern);
    validatePartDocument(doc);
    expect([...dependentFeatures(doc, 'plane')]).toEqual(['plane', 'axis', 'pattern']);
    const suppressed = setFeatureSuppressed(doc, 'plane', true);
    expect(suppressed.features.filter(f => f.suppressed).map(f => f.id)).toEqual(['plane', 'axis', 'pattern']);
    const restored = setFeatureSuppressed(suppressed, 'pattern', false);
    expect(restored.features.some(f => f.suppressed)).toBe(false);
    expect(featureReferenceErrors(restored).size).toBe(0);
    expect(doc.features.every(f => !f.suppressed)).toBe(true);
  });

  it('keeps a lost axis repairable across save/reopen and propagates its failure', () => {
    const doc = fixture(); doc.features.push(plane, axis, pattern);
    const broken = parsePartDocument(serializePartDocument(removeFeature(doc, 'axis')));
    expect(featureReferenceErrors(broken).get('pattern')).toMatch(/Missing reference: axis/);
    expect(broken.features.find(f => f.id === 'pattern')?.suppressed).toBe(false);
    broken.features.splice(3, 0, axis);
    validatePartDocument(broken);
    expect(featureReferenceErrors(broken).size).toBe(0);
  });

  it('copies bodies without making the pattern depend on itself or modifying its original', () => {
    const doc = fixture(); const body = bodyIDForFeature(doc, doc.features[1]);
    doc.features.push({ ...pattern, axisReference: undefined, bodyIds: [body], copyBodyIds: { [body]: 'copy' } });
    doc.features.push({ ...base, id: 'finish-original', type: 'fillet', targetBodyId: body, radiusMillimeters: 1 });
    doc.features.push({ ...base, id: 'finish-copy', type: 'fillet', targetBodyId: 'copy:1', radiusMillimeters: 1 });
    validatePartDocument(doc);
    const graph = featureDependencies(doc);
    expect(graph.get('pattern')).toEqual(['pad']);
    expect(graph.get('finish-original')).toEqual(['pad']);
    expect(graph.get('finish-copy')).toEqual(['pattern']);
    expect(featureReferenceErrors(doc).size).toBe(0);
    const hidden = setFeatureSuppressed(doc, 'pattern', true);
    expect(hidden.features.find(f => f.id === 'finish-original')?.suppressed).toBe(false);
    expect(hidden.features.find(f => f.id === 'finish-copy')?.suppressed).toBe(true);
  });

  it('resolves a surface modifier against its selected body, independently of the last body', () => {
    const doc = fixture(); const body = bodyIDForFeature(doc, doc.features[1]);
    doc.features.push({ ...base, id: 'sheet', type: 'surface-extrude', operation: 'new', profileFeatureId: 'sketch', distanceMillimeters: 8 });
    const sheet = bodyIDForFeature(doc, doc.features[2]);
    doc.features.push({ ...doc.features[1], id: 'unrelated', bodyId: 'unrelated-body' } as PartFeature);
    doc.features.push({ ...base, id: 'reverse', type: 'surface-reverse-normal', bodyIds: [sheet] });
    doc.features.push({ ...base, id: 'thicken', type: 'surface-thicken', bodyIds: [sheet], thicknessMillimeters: 1, operation: 'new' });
    validatePartDocument(doc);
    const graph = featureDependencies(doc);
    expect(graph.get('reverse')).toEqual(['sheet']);
    expect(graph.get('thicken')).toEqual(['reverse']);
    expect(dependentFeatures(doc, 'unrelated').has('reverse')).toBe(false);
    expect(dependentFeatures(doc, 'pad').has('reverse')).toBe(false);
    expect(body).not.toBe(sheet);
  });
});

const face = { sourceFeatureId: 'face-source', bodyId: 'body', normal: [0, 0, 1] as [number, number, number], label: 'Face' };
const edge = { kind: 'curved-edge' as const, sourceFeatureId: 'edge-source', bodyId: 'body', label: 'Edge', midpointMillimeters: [0, 0, 0] as [number, number, number], lengthMillimeters: 10 };
const cases: [string, PartFeature, string[]][] = [
  ['tangent plane', { ...base, id: 'f', type: 'plane', plane: 'XY', offsetMillimeters: 0, definition: { method: 'tangent', surface: { kind: 'surface-point', partId: 'body', faceId: 1, pointMillimeters: [0, 0, 0], normalMillimeters: [0, 0, 1] } } }, ['body-producer']],
  ['construction point', { ...base, id: 'f', type: 'point', definition: { method: 'three-planes', references: [{ kind: 'feature', featureId: 'plane' }, { kind: 'principal', plane: 'XZ' }, { kind: 'principal', plane: 'YZ' }] } }, ['plane']],
  ['revolve axis', { ...base, id: 'f', type: 'revolve', profileFeatureId: 'sketch', axis: 'Z', axisReference: { kind: 'feature', featureId: 'axis' }, angleDegrees: 360, operation: 'new' }, ['sketch', 'axis']],
  ['mirror transform', { ...base, id: 'f', type: 'transform', bodyIds: ['body'], transform: { kind: 'mirror', plane: { kind: 'feature', featureId: 'plane' } } }, ['body-producer', 'plane']],
  ['align transform', { ...base, id: 'f', type: 'transform', bodyIds: ['body'], transform: { kind: 'align', from: { kind: 'face', ...face }, to: { kind: 'face', ...face, sourceFeatureId: 'other-face' } } }, ['body-producer', 'face-source', 'other-face']],
  ['sweep guide rail', { ...base, id: 'f', type: 'sweep', profileFeatureId: 'sketch', pathFeatureId: 'path', rail: { pathFeatureId: 'rail' }, operation: 'new' }, ['sketch', 'path', 'rail']],
  ['loft sections and apex', { ...base, id: 'f', type: 'loft', sections: [{ profileFeatureId: 'sketch' }], endPoint: { kind: 'sketch-point', sourceFeatureId: 'apex-sketch', contourId: 'circle', point: 'center', label: 'Apex' }, operation: 'new', ruled: false }, ['sketch', 'apex-sketch']],
  ['fillet edge', { ...base, id: 'f', type: 'fillet', radiusMillimeters: 1, edges: [edge] }, ['edge-source']],
  ['shell opening', { ...base, id: 'f', type: 'shell', thicknessMillimeters: 1, removedFaces: [face] }, ['face-source']],
  ['surface blend', { ...base, id: 'f', type: 'surface-blend', operation: 'new', from: { bodyId: 'body', edges: [edge] }, to: { bodyId: 'other-body', edges: [{ ...edge, sourceFeatureId: 'other-edge' }] } }, ['body-producer', 'edge-source', 'body:other-body', 'other-edge']],
  ['sheet fold', { ...base, id: 'f', type: 'sheet-fold', bodyIds: ['body'], line: { kind: 'sketch-line', sourceFeatureId: 'fold-sketch', contourId: 'line', segmentId: 'segment' }, angleDegrees: 90 }, ['body-producer', 'fold-sketch']],
  ['plastic lip', { ...base, id: 'f', type: 'lip', targetBodyId: 'body', face, shape: 'lip', side: 'outside', widthMillimeters: 2, heightMillimeters: 3, gapMillimeters: 0 }, ['face-source']],
];
it.each(cases)('tracks explicit nested inputs: %s', (_label, feature, expected) => {
  expect(featureInputDependencies(feature, new Map([['body', 'body-producer']]))).toEqual(expected);
});
