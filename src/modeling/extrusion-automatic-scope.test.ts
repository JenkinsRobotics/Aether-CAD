import {afterEach,expect,it,vi} from 'vitest';
import {availableBodies,createEmptyPartDocument,featureDependencies,featureReferenceErrors,insertFeature,parsePartDocument,serializePartDocument,setFeatureSuppressed,type ExtrudeFeature,type PartDocument,type ExtrusionScopeResolution} from '@aether/core/document';
import {resolveExtrusionScopes} from './extrusion-scope-resolution';
import {resolveBodyOutputs} from './body-outputs';
import {supportForFace} from './sketch-support';
import {translateDocument} from '../freecad-translate';
import {buildWithFreeCAD} from '../freecad-geometry';
import {analyzePart} from './part-analysis';
import {createPartExport} from './part-export';
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
it('stores automatic intent and adopts only native scope projections without baking target lists',()=>{
 const doc=fixture(),next=resolveExtrusionScopes(doc,{e:merged});
 expect((doc.features.at(-1) as ExtrudeFeature).scopeResolution).toBeUndefined();
 expect(parsePartDocument(serializePartDocument(next))).toEqual(next);
 expect(availableBodies(next).map(b=>b.id)).toEqual(['a','other']);
 const native=translateDocument(next);expect(native.complete).toBe(true);expect(native.features.at(-1)?.parameters).toMatchObject({scope_mode:'all',operation:'add',region_mode:true});
 expect(native.features.at(-1)?.parameters).not.toHaveProperty('body_id');expect(native.features.at(-1)?.parameters).not.toHaveProperty('target_body_ids');expect(native.features.at(-1)?.parameters).not.toHaveProperty('scopeResolution');
 expect(availableBodies(setFeatureSuppressed(next,'e',true)).map(b=>b.id)).toEqual(['a','b','other']);
 expect(availableBodies({...next,rollbackIndex:7}).map(b=>b.id)).toEqual(['a','b','other']);
});
it('updates membership both ways and keeps pending dynamic body references evaluable',()=>{
 const doc=resolveExtrusionScopes(fixture(),{e:merged});
 const following=insertFeature(doc,{id:'later',name:'Later cut',type:'extrude',profileFeatureId:'s',operation:'cut',targetBodyId:'b',distanceMillimeters:2,suppressed:false});
 expect(featureReferenceErrors(following).size).toBe(0);expect(featureDependencies(following).get('later')).toContain('e');
 expect(translateDocument(following).complete).toBe(true); // Native decides whether b still exists.
 const separated=resolveExtrusionScopes(doc,{e:{targets:['a'],groups:[{bodyId:'a',sources:['a']}]}});
 expect(availableBodies(separated).map(b=>b.id)).toEqual(['a','b','other']);
 const hidden=setFeatureSuppressed(doc,'b',true);expect(hidden.features.at(-1)?.suppressed).toBe(false);expect(translateDocument(hidden).complete).toBe(true);
 const deleted={...doc,features:doc.features.filter(f=>f.id!=='b')};expect(translateDocument(deleted).complete).toBe(true);
});
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
afterEach(()=>vi.unstubAllGlobals());
it.each(['build','analysis','export'])('gates %s against old workers',async mode=>{
 const doc=fixture();const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,capabilities:[]})});vi.stubGlobal('fetch',fetch);
 await expect(mode==='build'?buildWithFreeCAD(translateDocument(doc).features):mode==='analysis'?analyzePart(doc,{kind:'properties'}):createPartExport(doc,'step')).rejects.toThrow(/automatic extrusion scope/);expect(fetch).toHaveBeenCalledTimes(1);
});
