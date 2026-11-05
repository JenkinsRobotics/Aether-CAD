import {expect,it} from 'vitest';
import {availableBodies,createEmptyPartDocument,parsePartDocument,serializePartDocument,setFeatureSuppressed,type PartDocument,type ExtrusionScopeResolution} from '@aether/core/document';
import {resolveExtrusionScopes} from './extrusion-scope-resolution';
import {resolveBodyOutputs} from './body-outputs';
import {supportForFace} from './sketch-support';
import {finalizeCandidate,prepareCommand} from '../automation/commands';

const merged:ExtrusionScopeResolution={targets:['a','b'],groups:[{bodyId:'a',sources:['a','b']}]};
function fixture():PartDocument {
 const doc=createEmptyPartDocument('Automatic scope');
 for(const [id,z] of [['a',0],['b',20],['other',40]] as const){doc.features.push(
  {id:id+'-s',type:'profile',name:id+' profile',plane:'XY',offsetMillimeters:z,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[-5,-5],[5,-5],[5,5],[-5,5]]}},
  {id,type:'extrude',name:id,profileFeatureId:id+'-s',operation:'new',bodyId:id,distanceMillimeters:5,suppressed:false});}
 doc.features.push({id:'s',type:'profile',name:'Bridge profile',plane:'XY',offsetMillimeters:5,suppressed:false,profile:{type:'circle',centerMillimeters:[0,0],radiusMillimeters:2}},
 {id:'e',type:'extrude',name:'Bridge',profileFeatureId:'s',operation:'add',distanceMillimeters:15,scopeMode:'all',suppressed:false});
 return doc;
}
it('supports disconnected groups and full removal while preserving source body properties',()=>{
 const doc=fixture();doc.bodyProperties={a:{name:'Aluminum',visible:true},b:{name:'Plastic',visible:true}};
 const groups=resolveExtrusionScopes(doc,{e:{targets:['a','b'],groups:[{bodyId:'a',sources:['a']},{bodyId:'b',sources:['b']}]}});
 expect(availableBodies(groups).map(b=>b.name)).toEqual(['Aluminum','Plastic','Body 3']);
 const removed=fixture();Object.assign(removed.features.at(-1)!,{operation:'cut'});
 expect(availableBodies(resolveExtrusionScopes(removed,{e:{targets:['a','b'],groups:[]}})).map(b=>b.id)).toEqual(['other']);
 const frame={originMillimeters:[0,0,25] as [number,number,number],normal:[0,0,1] as [number,number,number],xDirection:[1,0,0] as [number,number,number]};
 expect(supportForFace(resolveExtrusionScopes(doc,{e:merged}),'a',frame,'Top')?.sourceFeatureId).toBe('e');
 expect(supportForFace(resolveExtrusionScopes(doc,{e:merged}),'b',frame,'Top')).toBeUndefined();
});
it('retains every native producer identity before applying consumed scope',()=>{
 const doc=fixture();for(const f of doc.features)if(f.type==='extrude'&&f.operation==='new'){f.separateBodies=true;f.bodyOutputs=[f.bodyId!+':solid-1'];}
 const outputs={a:['a:solid-1'],b:['b:solid-1'],other:['other:solid-1']};
 const resolved=resolveExtrusionScopes(resolveBodyOutputs(doc,outputs),{e:{targets:['a:solid-1','b:solid-1'],groups:[{bodyId:'a:solid-1',sources:['a:solid-1','b:solid-1']}]}});
 expect(availableBodies(resolved).map(b=>b.id)).toEqual(['a:solid-1','other:solid-1']);expect(availableBodies(setFeatureSuppressed(resolved,'e',true)).map(b=>b.id)).toEqual(Object.values(outputs).flat());
});
it.each([{}, {e:{targets:['missing'],groups:[{bodyId:'missing',sources:['missing']}]}}, {e:{targets:['a','b'],groups:[{bodyId:'a',sources:['a']}]}}, {e:{targets:['a'],groups:[{bodyId:'b',sources:['a']}]}}, {e:merged,wrong:merged}])('rejects incomplete or foreign native projections %s',result=>{
 expect(()=>resolveExtrusionScopes(fixture(),result as any)).toThrow(/scope|discard|unavailable|resolve/i);
});
it.each([{scopeMode:'nearest'},{targetBodyId:'a'},{targetBodyIds:['a']},{operation:'new'},{scopeResolution:{targets:['a','a'],groups:[]}}])('rejects invalid automatic scope records %s',patch=>{
 const doc=fixture();Object.assign(doc.features.at(-1)!,patch);expect(()=>serializePartDocument(doc)).toThrow(/scope/i);
});
it('saved depth edits keep automatic intent and finalize fresh scope rather than stale membership',()=>{
 const doc=resolveExtrusionScopes(fixture(),{e:merged});const prepared=prepareCommand('cad.extrude.setdepth',serializePartDocument(doc),{feature_id:'e',depth_mm:10});
 const next=parsePartDocument(finalizeCandidate(prepared.candidate!,{}, {},{e:{targets:['a'],groups:[{bodyId:'a',sources:['a']}]}}));
 expect(availableBodies(next).map(b=>b.id)).toEqual(['a','b','other']);expect(next.features.at(-1)).toMatchObject({scopeMode:'all',distanceMillimeters:10});
});

it('publishes explicit Surface Add groups and validates native scope ownership', () => {
 const doc = fixture();
 Object.assign(doc.features.at(-1)!, { type: 'surface-extrude', operation: 'add', scopeMode: undefined,
  connectedMerge: true, targetBodyId: 'a', targetBodyIds: ['a', 'b'] });
 const scopes = { e: { targets: ['a', 'b'], groups: [{ bodyId: 'a', sources: ['a'] }, { bodyId: 'b', sources: ['b'] }] } };
 const resolved = resolveExtrusionScopes(doc, scopes);
 expect(availableBodies(resolved).map(body => body.id)).toEqual(['a', 'b', 'other']);
 const frame = { originMillimeters: [0,0,25] as [number,number,number], normal: [0,0,1] as [number,number,number], xDirection: [1,0,0] as [number,number,number] };
 expect(supportForFace(resolved, 'b', frame, 'Top')?.sourceFeatureId).toBe('e');
 expect(parsePartDocument(serializePartDocument(resolved)).features.at(-1)).toEqual(resolved.features.at(-1));
 expect(() => resolveExtrusionScopes(doc, {})).toThrow(/resolve/);
 expect(() => resolveExtrusionScopes(doc, { e: { targets: ['a', 'other'], groups: [{ bodyId: 'a', sources: ['a','other'] }] } })).toThrow(/selected scope/);
 expect(availableBodies(setFeatureSuppressed(resolveExtrusionScopes(doc, {e: merged}), 'e', true)).map(body=>body.id)).toEqual(['a','b','other']);
});
