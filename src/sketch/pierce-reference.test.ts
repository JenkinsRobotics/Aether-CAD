import { expect, it } from 'vitest';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument } from '@aether/core/document';
import type { ProfileFeature } from '@aether/core/document';
import { referenceSketchPierce, resolveSketchPierce } from '../../freecad-engine/browser/pierce-reference';

const profile=(id:string,plane:'XY'|'XZ'):ProfileFeature=>({id,type:'profile',name:id,plane,offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[]}});
function setup() {
  const doc=createEmptyPartDocument('Pierce references'),source=profile('source','XY'),target=profile('target','XZ');
  source.profile={type:'drawing',contours:[{type:'path',start:[0,-5],segments:[{type:'line',end:[20,5]}]}]};
  doc.features.push(source,target);return doc;
}
it('returns stable source identities and a selected branch without mutating the input',()=>{
  const doc=setup(),before=structuredClone(doc);let id=0;
  const result=referenceSketchPierce(doc,'target','source',0,0,0,()=>`id-${++id}`);
  expect(result.reference).toMatchObject({kind:'sketch-curve',sourceFeatureId:'source',sourceContourId:'id-1',sourceSegmentId:'id-3',branch:{direction:-1,counts:[1,0,0],ordinal:0}});
  expect(result.hit.worldPoint).toEqual([10,0,0]);expect(doc).toEqual(before);
  expect(result.document.features[1]).toEqual(doc.features[1]);
});
it('follows source edits after a document save/reopen and an independent reference roundtrip',()=>{
  const result=referenceSketchPierce(setup(),'target','source',0,0,0);
  const doc=parsePartDocument(serializePartDocument(result.document)),reference=JSON.parse(JSON.stringify(result.reference));
  const source=doc.features[0];if(source.type!=='profile'||source.profile.type!=='drawing')throw Error();
  const path=source.profile.contours[0];if(path.type!=='path')throw Error();path.segments[0].end=[40,5];
  expect(resolveSketchPierce(doc.features,'target',reference).worldPoint).toEqual([20,0,0]);
  // Creating a source reference alone must not add an authored relationship.
  expect(serializePartDocument(doc)).not.toContain('sketch-curve');
});
it('retains the selected segment through unrelated contour and segment insertion',()=>{
  const result=referenceSketchPierce(setup(),'target','source',0,0,0),source=result.document.features[0];
  if(source.type!=='profile'||source.profile.type!=='drawing')throw Error();
  const path=source.profile.contours[0];if(path.type!=='path')throw Error();
  path.segments.unshift({id:'prefix',type:'line',end:[...path.start]});path.start=[-10,-10];
  source.profile.contours.unshift({type:'circle',center:[100,100],radius:4,id:'unrelated'});
  expect(resolveSketchPierce(result.document.features,'target',result.reference).worldPoint).toEqual([10,0,0]);
});
it.each(['remove','suppress','replace','duplicate','reorder'])('refuses %s instead of attaching to another source',change=>{
  const result=referenceSketchPierce(setup(),'target','source',0,0,0),features=result.document.features,source=features[0];
  if(source.type!=='profile'||source.profile.type!=='drawing')throw Error();
  const path=source.profile.contours[0];if(path.type!=='path')throw Error();
  if(change==='remove')source.profile.contours=[];
  if(change==='suppress')source.suppressed=true;
  if(change==='replace')path.segments[0].id='replacement';
  if(change==='duplicate')source.profile.contours.push(structuredClone(path));
  if(change==='reorder')features.reverse();
  expect(()=>resolveSketchPierce(features,'target',result.reference)).toThrow(/Pierce|identities/);
});
it('reports an intersection that moves outside the finite source',()=>{
  const result=referenceSketchPierce(setup(),'target','source',0,0,0),source=result.document.features[0];
  if(source.type!=='profile'||source.profile.type!=='drawing')throw Error();
  const path=source.profile.contours[0];if(path.type!=='path')throw Error();path.start=[0,2];
  expect(()=>resolveSketchPierce(result.document.features,'target',result.reference)).toThrow(/disappeared/);
});
it('supports a full-circle source with no invented segment identity',()=>{
  const doc=setup(),source=doc.features[0];if(source.type!=='profile')throw Error();source.profile={type:'circle',centerMillimeters:[0,0],radiusMillimeters:5};
  const result=referenceSketchPierce(doc,'target','source',0,undefined,1);expect(result.reference.sourceSegmentId).toBeUndefined();
  expect(resolveSketchPierce(result.document.features,'target',result.reference).worldPoint[0]).toBeCloseTo(-5,9);
});
