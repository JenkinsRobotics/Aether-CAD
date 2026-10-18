import {it,expect} from 'vitest';
import {createRectanglePartDocument,bodyIDForFeature,insertFeature,serializePartDocument,parsePartDocument,featureDependencies,setFeatureSuppressed,moveFeature,type FaceTransform} from '@aether/core/document';
import {translateDocument} from '../freecad-translate';
function model(transform:FaceTransform) {
 const doc=createRectanglePartDocument('Move face',{widthMillimeters:10,heightMillimeters:20,depthMillimeters:5});
 const base=doc.features.at(-1)!,body=bodyIDForFeature(doc,base);
 const withGuide=insertFeature(doc,{id:'guide',type:'profile',name:'Guide',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{id:'path',type:'path',construction:true,start:[0,0],segments:[{id:'line',type:'line',end:[3,4]}]}]}});
 return insertFeature(withGuide,{id:'move',type:'offset-face',name:'Move face',suppressed:false,faces:[{sourceFeatureId:base.id,bodyId:body,normal:[0,0,1],label:'Top'}],transform});
}
const line={kind:'sketch-line' as const,sourceFeatureId:'guide',contourId:'path',segmentId:'line'};
it.each<FaceTransform>([
 {kind:'translate',translationMillimeters:[2,3,4]},
 {kind:'rotate',axisOriginMillimeters:[0,0,5],axisDirection:[1,0,0],angleDegrees:15},
 {kind:'translate-reference',reference:line,distanceMillimeters:-12,reversed:true},
 {kind:'rotate-reference',reference:line,angleDegrees:20},
])('roundtrips and rebuilds face $kind with one movement authority',transform=>{
 const doc=model(transform),saved=parsePartDocument(serializePartDocument(doc));expect(saved.features).toEqual(doc.features);
 const translated=translateDocument(saved);expect(translated.untranslated).toEqual([]);const p:any=translated.features.at(-1)?.parameters;
 expect(p).not.toHaveProperty('distance_mm');expect(p.transform.kind).toBe(transform.kind);
 if(transform.kind.endsWith('reference')){
  expect(p.transform.reference).toMatchObject({kind:'two-points',to:{local_point:[3,4]}});expect(featureDependencies(doc).get('move')).toContain('guide');
  expect(setFeatureSuppressed(doc,'guide',true).features.at(-1)?.suppressed).toBe(true);expect(()=>moveFeature(doc,'guide',1)).toThrow();
 }
});
it.each(['both','copy','scale','axis','angle','move','future'])('rejects invalid face transform %s',bad=>{
 const doc=model({kind:'rotate',axisOriginMillimeters:[0,0,0],axisDirection:[1,0,0],angleDegrees:15}),f:any=doc.features.at(-1);
 if(bad==='both')f.distanceMillimeters=2;if(bad==='copy')f.transform={kind:'copy'};if(bad==='scale')f.transform={kind:'scale',scaleFactors:[2,2,2],centerMillimeters:[0,0,0]};if(bad==='axis')f.transform.axisDirection=[0,0,0];if(bad==='angle')f.transform.angleDegrees=NaN;if(bad==='move')f.transform={kind:'translate',translationMillimeters:[0,Infinity,0]};if(bad==='future'){f.transform={kind:'rotate-reference',reference:line,angleDegrees:10};doc.features.push(doc.features.splice(2,1)[0]);}
 expect(()=>serializePartDocument(doc)).toThrow();
});
it('retains missing reference history for repair without stale coordinate fallback',()=>{
 const doc=model({kind:'rotate-reference',reference:line,angleDegrees:10});doc.features=doc.features.filter(f=>f.id!=='guide');
 expect(parsePartDocument(serializePartDocument(doc))).toEqual(doc);expect(translateDocument(doc).untranslated.some(f=>f.id==='move')).toBe(true);
});
