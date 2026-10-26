import { expect, it } from 'vitest';
import { createRectanglePartDocument, serializePartDocument } from '@aether/core/document';
import { inspectFeatureReferences } from './feature-inspection';
import { prepareFeatureOperation } from '../operations/feature-operations';

const fixture = () => createRectanglePartDocument('Graph', { widthMillimeters: 10, heightMillimeters: 20, depthMillimeters: 5 },
  { documentId: 'doc', sketchId: 'sketch', extrudeId: 'pad' });

it('shows nested construction inputs and refuses deleting them even beyond rollback', () => {
  const doc = fixture();
  doc.features.push({ id: 'plane', name: 'Datum', type: 'plane', plane: 'XY', offsetMillimeters: 0, suppressed: false });
  doc.features.push({ id: 'axis', name: 'Hinge axis', type: 'axis', suppressed: false, definition: {
    method: 'two-planes', references: [{ kind: 'feature', featureId: 'plane' }, { kind: 'principal', plane: 'XZ' }],
  } });
  doc.rollbackIndex = 3;
  expect(inspectFeatureReferences(doc, { feature_id: 'axis' }).references).toMatchObject([{ id: 'plane', exists: true }]);
  expect(inspectFeatureReferences(doc, { feature_id: 'plane', direction: 'dependents' }).references).toMatchObject([{ id: 'axis', rolled_back: true }]);
  expect(() => prepareFeatureOperation(doc, 'aether_cad_feature_delete', { feature_id: 'plane' })).toThrow(/axis.*depend/);
});
it('reports canonical inputs and direct dependents, including suppressed and rolled-back features', () => {
  const doc = fixture(); doc.features[1].suppressed = true; doc.rollbackIndex = 1;
  const before = serializePartDocument(doc);
  expect(inspectFeatureReferences(doc,{feature_id:'pad'}).references).toMatchObject([{id:'sketch',exists:true}]);
  const result = inspectFeatureReferences(doc,{feature_id:'sketch',direction:'dependents'});
  expect(result).toMatchObject({total:1,transitive:false,topology_verified:false,references:[{id:'pad',exists:true,suppressed:true,rolled_back:true}]});
  expect(serializePartDocument(doc)).toBe(before);
});
it('pages history references without silently dropping them', () => {
  const doc=fixture(); const pad=doc.features[1];
  doc.features.push({...pad,id:'second'}, {...pad,id:'third'});
  const first=inspectFeatureReferences(doc,{feature_id:'sketch',direction:'dependents',limit:1});
  expect(first).toMatchObject({total:3,next_offset:1,references:[{id:'pad'}]});
  const last=inspectFeatureReferences(doc,{feature_id:'sketch',direction:'dependents',offset:2,limit:1});
  expect(last).toMatchObject({next_offset:null,references:[{id:'third'}]});
});
it('distinguishes a missing reference from a verified geometric reference', () => {
  const doc=fixture(); Object.assign(doc.features[1],{profileFeatureId:'missing'});
  expect(inspectFeatureReferences(doc,{feature_id:'pad'}).references).toEqual([{id:'missing',exists:false}]);
});
it.each([{feature_id:'unknown'},{feature_id:'pad',limit:51},{feature_id:'pad',offset:0.5},{feature_id:'pad',direction:'all'}])('rejects invalid inspection %j',args=>{
  expect(()=>inspectFeatureReferences(fixture(),args)).toThrow();
});
