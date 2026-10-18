import {expect,it} from 'vitest';
import {createRectanglePartDocument,insertFeature,bodyIDForFeature,serializePartDocument,parsePartDocument,featureDependencies,moveFeature,setFeatureSuppressed,type PartTransform,type PartDocument} from '@aether/core/document';
import {translateDocument} from '../freecad-translate';
const line={kind:'sketch-line' as const,sourceFeatureId:'guide',contourId:'path',segmentId:'line'};
const point=(vertexId:string)=>({kind:'sketch-point' as const,sourceFeatureId:'guide',contourId:'path',point:'vertex' as const,vertexId,label:vertexId});
function model(transform:PartTransform):PartDocument {
 const doc=createRectanglePartDocument('Reference',{widthMillimeters:10,heightMillimeters:20,depthMillimeters:5});
 const body=bodyIDForFeature(doc,doc.features.at(-1)!);
 const guide:any={id:'guide',type:'profile',name:'Guide',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{id:'path',type:'path',construction:true,start:[1,2],startVertexId:'a',segments:[{id:'line',type:'line',end:[4,6],endVertexId:'b'}]}]}};
 return insertFeature(insertFeature(doc,guide),{id:'transform',type:'transform',name:'Transform',suppressed:false,bodyIds:[body],transform:structuredClone(transform)});
}
it.each<PartTransform>([
 {kind:'translate-reference',reference:line},
 {kind:'translate-reference',reference:{kind:'two-points',from:point('a'),to:point('b')},distanceMillimeters:15,reversed:true},
 {kind:'rotate-reference',reference:line,angleDegrees:42},
 {kind:'scale-reference',centerReference:point('b'),scaleFactors:[2,2,2]},
])('roundtrips referenced $kind without freezing coordinates and tracks history',transform=>{
 const doc=model(transform),restored=parsePartDocument(serializePartDocument(doc));
 expect(restored.features.at(-1)).toEqual(doc.features.at(-1));
 expect(featureDependencies(doc).get('transform')).toContain('guide');
 expect(()=>moveFeature(doc,'guide',1)).toThrow();
 expect(setFeatureSuppressed(doc,'guide',true).features.at(-1)?.suppressed).toBe(true);
 const translated=translateDocument(restored);expect(translated.untranslated).toEqual([]);
 const native:any=translated.features.at(-1)?.parameters.transform;
 if(transform.kind==='scale-reference')expect(native.centerReference).toMatchObject({local_point:[4,6],frame:{normal:[0,-1,0]}});
 else expect(native.reference).toMatchObject({kind:'two-points',from:{local_point:[1,2]},to:{local_point:[4,6]}});
 expect(JSON.stringify(transform)).not.toContain('local_point');
});
it('follows changed and reordered line geometry and refuses a replaced segment',()=>{
 const doc=model({kind:'translate-reference',reference:line});const guide:any=doc.features.find(f=>f.id==='guide');
 guide.profile.contours[0].segments[0].end=[8,10];guide.profile.contours.unshift({id:'other',type:'circle',center:[99,99],radius:1});
 expect((translateDocument(doc).features.at(-1)?.parameters.transform as any).reference.to.local_point).toEqual([8,10]);
 guide.profile.contours[1].segments[0].id='replacement';
 const result=translateDocument(doc);expect(result.features.some(f=>f.id==='transform')).toBe(false);expect(result.untranslated.some(f=>f.id==='transform')).toBe(true);
});
it.each(['missing','later','wrong-type','zero-id','bad-distance','bad-scale','bad-axis'])('handles %s references without silently reverting to numeric transform',kind=>{
 const doc=model({kind:'translate-reference',reference:line});const f:any=doc.features.at(-1);
 if(kind==='missing'){doc.features=doc.features.filter(f=>f.id!=='guide');expect(parsePartDocument(serializePartDocument(doc))).toEqual(doc);expect(translateDocument(doc).untranslated.some(f=>f.id==='transform')).toBe(true);return;}
 if(kind==='later')doc.features.push(doc.features.splice(2,1)[0]);
 if(kind==='wrong-type')f.transform.reference.sourceFeatureId=doc.features[1].id;
 if(kind==='zero-id')f.transform.reference.segmentId='';
 if(kind==='bad-distance')f.transform.distanceMillimeters=Infinity;
 if(kind==='bad-scale')f.transform={kind:'scale-reference',centerReference:point('a'),scaleFactors:[1,0,1]};
 if(kind==='bad-axis')f.transform.reference={kind:'something-else'};
 expect(()=>serializePartDocument(doc)).toThrow();
});
