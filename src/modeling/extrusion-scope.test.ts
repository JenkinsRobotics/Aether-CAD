import {expect,it} from 'vitest';
import {availableBodies,createEmptyPartDocument,insertFeature,parsePartDocument,serializePartDocument,featureReferenceErrors,featureDependencies,setFeatureSuppressed,type ExtrudeFeature} from '@aether/core/document';
import {translateDocument} from '../freecad-translate';
import {supportForFace} from './sketch-support';
function fixture(){
 let doc=createEmptyPartDocument('Scope');
 doc=insertFeature(doc,{id:'s',type:'profile',name:'Profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',radiusMillimeters:2,centerMillimeters:[0,0]}});
 for(const id of ['a','b','other'])doc=insertFeature(doc,{id,type:'extrude',name:id,profileFeatureId:'s',operation:'new',bodyId:id,distanceMillimeters:10,suppressed:false});
 const cut:ExtrudeFeature={id:'cut',type:'extrude',name:'Cut both',profileFeatureId:'s',operation:'cut',targetBodyId:'a',targetBodyIds:['a','b'],distanceMillimeters:2,suppressed:false};
 return {doc,cut};
}
it('roundtrips a scoped cut and translates all explicit target identities',()=>{
 const {doc,cut}=fixture();const saved=parsePartDocument(serializePartDocument(insertFeature(doc,cut)));
 expect(saved.features.at(-1)).toEqual(cut);
 expect(translateDocument(saved).features.at(-1)).toMatchObject({kind:'pocket',parameters:{body_id:'a',target_body_ids:['a','b'],region_mode:true}});
});
it('tracks dependencies and suppression for every target, including supported faces on the second body',()=>{
 const {doc,cut}=fixture();const saved=insertFeature(doc,cut);
 expect(featureDependencies(saved).get('cut')).toEqual(expect.arrayContaining(['a','b','s']));
 expect(setFeatureSuppressed(saved,'b',true).features.at(-1)!.suppressed).toBe(true);
 const deleted={...saved,features:saved.features.filter(f=>f.id!=='b')};
 expect(featureReferenceErrors(deleted).get('cut')).toMatch(/Missing reference/);
 expect(translateDocument(deleted).untranslated.some(f=>f.id==='cut')).toBe(true);
 expect(supportForFace(saved,'b',{originMillimeters:[0,0,10],xDirection:[1,0,0],normal:[0,0,1]},'Top')?.sourceFeatureId).toBe('cut');
});
it('refuses malformed scope instead of silently falling back to a single target',()=>{
 const {doc,cut}=fixture();
 for(const scope of [[],['a','a'],['b','a'],['a',null]])expect(()=>insertFeature(doc,{...cut,targetBodyIds:scope} as ExtrudeFeature)).toThrow(/scope/);
 expect(()=>insertFeature(doc,{...cut,operation:'new'})).toThrow(/scope/);
});
it('persists Add scope, consumes only selected extra outputs and restores them on suppression',()=>{
 const {doc,cut}=fixture();doc.bodyProperties={a:{name:'Primary',visible:true},b:{name:'Secondary',visible:true}};
 const merged=parsePartDocument(serializePartDocument(insertFeature(doc,{...cut,operation:'add'})));
 expect(availableBodies(merged).map(b=>b.id)).toEqual(['a','other']);
 expect(availableBodies(merged)[0].name).toBe('Primary');
 expect(merged.bodyProperties).toEqual(doc.bodyProperties);
 expect(translateDocument(merged).features.at(-1)).toMatchObject({kind:'pad',parameters:{operation:'add',target_body_ids:['a','b']}});
 expect(featureDependencies(merged).get('cut')).toEqual(expect.arrayContaining(['a','b']));
 expect(availableBodies(setFeatureSuppressed(merged,'cut',true)).map(b=>b.id)).toEqual(['a','b','other']);
 const restored=insertFeature(setFeatureSuppressed(merged,'cut',true),{...cut,id:'edit-restored',targetBodyId:'b',targetBodyIds:undefined});
 expect(featureReferenceErrors(restored).size).toBe(0);
 expect(featureDependencies(restored).get('edit-restored')).toContain('b');
 const restoredAgain=setFeatureSuppressed(setFeatureSuppressed(restored,'edit-restored',true),'edit-restored',false);
 expect(restoredAgain.features.find(f=>f.id==='cut')?.suppressed).toBe(true);
 expect(featureReferenceErrors(restoredAgain).size).toBe(0);
 expect(availableBodies({...merged,rollbackIndex:doc.features.length}).map(b=>b.id)).toEqual(['a','b','other']);
 const missing={...merged,features:merged.features.filter(f=>f.id!=='b')};
 expect(featureReferenceErrors(missing).get('cut')).toMatch(/Missing reference/);
 expect(availableBodies(missing).map(b=>b.id)).toEqual(['a','other']);
});
it('uses the merged primary for implicit downstream targets and rejects consumed targets',()=>{
 const {doc,cut}=fixture();const merged=insertFeature(doc,{...cut,operation:'add'});
 const follow={...cut,id:'follow',targetBodyId:undefined,targetBodyIds:undefined};
 const following={...merged,features:[...merged.features,follow]};
 expect(featureDependencies(following).get('follow')).toContain('cut');
 expect(translateDocument(following).features.at(-1)?.parameters.body_id).toBe('a');
 const pinned=insertFeature(following,{...follow,id:'another',targetBodyId:'a'});
 expect(pinned.features.find(f=>f.id==='follow')).toMatchObject({targetBodyId:'a'});
 const invalid=insertFeature(merged,{...follow,targetBodyId:'b'});
 expect(featureReferenceErrors(invalid).get('follow')).toMatch(/body:b/);
 const frame={originMillimeters:[0,0,10] as [number,number,number],xDirection:[1,0,0] as [number,number,number],normal:[0,0,1] as [number,number,number]};
 expect(supportForFace(merged,'a',frame,'Top')?.sourceFeatureId).toBe('cut');
 expect(supportForFace(merged,'b',frame,'Top')).toBeUndefined();
 expect(supportForFace(following,'a',frame,'Top')?.sourceFeatureId).toBe('follow');
 const singleScope=insertFeature(doc,{...cut,operation:'add',targetBodyIds:['a']});
 const singleFollowing={...singleScope,features:[...singleScope.features,follow]};
 expect(availableBodies(singleScope).map(b=>b.id)).toEqual(['a','b','other']);
 expect(featureDependencies(singleFollowing).get('follow')).toContain('other');
 expect(translateDocument(singleFollowing).features.at(-1)?.parameters.body_id).toBe('other');
});
