import {expect,it} from 'vitest';
import {createRectanglePartDocument,insertFeature,bodyIDForFeature,serializePartDocument,parsePartDocument,featureDependencies,moveFeature,setFeatureSuppressed,type PartTransform,type PartDocument,featureReferenceErrors} from '@aether/core/document';
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
 expect(JSON.stringify(transform)).not.toContain('local_point');
});
it.each(['missing','later','wrong-type','zero-id','bad-distance','bad-scale','bad-axis'])('handles %s references without silently reverting to numeric transform',kind=>{
 const doc=model({kind:'translate-reference',reference:line});const f:any=doc.features.at(-1);
 if(kind==='missing'){doc.features=doc.features.filter(f=>f.id!=='guide');expect(parsePartDocument(serializePartDocument(doc))).toEqual(doc);expect(featureReferenceErrors(doc).has('transform')).toBe(true);return;}
 if(kind==='later')doc.features.push(doc.features.splice(2,1)[0]);
 if(kind==='wrong-type')f.transform.reference.sourceFeatureId=doc.features[1].id;
 if(kind==='zero-id')f.transform.reference.segmentId='';
 if(kind==='bad-distance')f.transform.distanceMillimeters=Infinity;
 if(kind==='bad-scale')f.transform={kind:'scale-reference',centerReference:point('a'),scaleFactors:[1,0,1]};
 if(kind==='bad-axis')f.transform.reference={kind:'something-else'};
 expect(()=>serializePartDocument(doc)).toThrow();
});
