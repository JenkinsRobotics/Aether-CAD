import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { measureVolume } from 'replicad';
import { initNodeKernel } from './node-kernel';
import { evaluatePartDocument } from './part-evaluator';
import { createRectanglePartDocument, parsePartDocument, serializePartDocument } from '../document/index';

beforeAll(() => initNodeKernel(readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url))), 30000);

it.each(['single', 'selected', 'all'] as const)('rebuilds editable Revolve Intersect with %s scope and retains body identities on reopen', scope => {
  const doc = createRectanglePartDocument('Revolved intersection', {widthMillimeters:20,heightMillimeters:20,depthMillimeters:10});
  const target = evaluatePartDocument(doc).parts[0].id;
  doc.features.push(
    {id:'second-profile',type:'profile',name:'Second profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[-30,-10],[-10,-10],[-10,10],[-30,10]]}},
    {id:'second',type:'extrude',name:'Second block',profileFeatureId:'second-profile',distanceMillimeters:10,operation:'new',bodyId:'second-body',suppressed:false},
    {id:'section',type:'profile',name:'Revolve section',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[0,4],[40,4],[40,6],[0,6]]}},
    {id:'intersection',type:'revolve',name:'Intersect',profileFeatureId:'section',axis:'Z',angleDegrees:360,operation:'intersect',suppressed:false,
      ...(scope==='all'?{scopeMode:'all'}:{targetBodyId:target,...(scope==='selected'?{targetBodyIds:[target,'second-body']}:{})})},
  );
  const volumes = () => {
    const result:Record<string,number>={};
    evaluatePartDocument(parsePartDocument(serializePartDocument(doc)), {withBodies:bodies=>{for(const [id,body] of bodies) result[id]=measureVolume(body);}});
    return result;
  };
  expect(volumes()).toEqual({[target]:expect.closeTo(800,5),'second-body':expect.closeTo(scope==='single'?4000:800,5)});
  const section = doc.features.find(f=>f.id==='section')!;
  if(section.type!=='profile'||section.profile.type!=='polygon') throw Error('Missing editable section');
  section.profile.pointsMillimeters=[[0,4],[40,4],[40,8],[0,8]];
  expect(volumes()).toEqual({[target]:expect.closeTo(1600,5),'second-body':expect.closeTo(scope==='single'?4000:1600,5)});
  section.profile.pointsMillimeters=[[0,4],[40,4],[40,6],[0,6]];
  expect(volumes()[target]).toBeCloseTo(800,5);
},60000);

it('honors the angular extent and rejects missing scope targets without modifying the source', () => {
  const doc = createRectanglePartDocument('Angular intersection',{widthMillimeters:20,heightMillimeters:20,depthMillimeters:10});
  const target = evaluatePartDocument(doc).parts[0].id;
  doc.features.push(
    {id:'section',type:'profile',name:'Section',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[0,4],[40,4],[40,6],[0,6]]}},
    {id:'intersection',type:'revolve',name:'Intersect',profileFeatureId:'section',axis:'Z',angleDegrees:180,operation:'intersect',targetBodyId:target,suppressed:false},
  );
  let volume = 0;
  evaluatePartDocument(doc,{withBodies:bodies=>{volume=measureVolume(bodies.get(target)!);}});
  expect(volume).toBeCloseTo(400,5);
  const before=serializePartDocument(doc);
  const invalid=parsePartDocument(before);
  Object.assign(invalid.features.at(-1)!,{targetBodyId:'unavailable'});
  expect(()=>evaluatePartDocument(invalid)).toThrow();
  expect(serializePartDocument(doc)).toBe(before);
  const missed=parsePartDocument(before);
  const profile=missed.features.find(f=>f.id==='section')!;
  if(profile.type==='profile' && profile.profile.type==='polygon') profile.profile.pointsMillimeters=[[0,20],[40,20],[40,22],[0,22]];
  expect(()=>evaluatePartDocument(missed)).toThrow();
});
