import {expect,it} from 'vitest';
import {createRectanglePartDocument,bodyIDForFeature,insertFeature,removeFeature,moveFeature,featureDependencies,parsePartDocument,serializePartDocument,featureReferenceErrors,setFeatureSuppressed,validatePartDocument,type OffsetFaceFeature} from '@aether/core/document';
import {translateDocument} from '../freecad-translate';
import {sourceFeatureForBody} from './sketch-support';
function fixture(){
 const doc=createRectanglePartDocument('Block',{widthMillimeters:10,heightMillimeters:20,depthMillimeters:10});
 const source=doc.features.find(f=>f.type==='extrude')!,body=bodyIDForFeature(doc,source);
 const feature:OffsetFaceFeature={id:'offset',type:'offset-face',name:'Offset faces',suppressed:false,distanceMillimeters:-1,
  faces:[{sourceFeatureId:source.id,bodyId:body,normal:[0,0,1],label:'Top'}]};
 return {doc,source,body,feature};
}
it('roundtrips native multi-face offsets without manufacturing an independent target scope',()=>{
 const {doc,source,body,feature}=fixture();feature.faces.push({sourceFeatureId:source.id,bodyId:body,surfaceType:'cylinder',label:'Wall'});
 const saved=insertFeature(doc,feature),reopened=parsePartDocument(serializePartDocument(saved));
 expect(reopened.features.at(-1)).toEqual(feature);
 expect(translateDocument(reopened).features.at(-1)).toEqual({id:'offset',kind:'offset-face',parameters:{distance_mm:-1,faces:feature.faces}});
 expect(sourceFeatureForBody(reopened,body)).toBe('offset');
 const later=insertFeature(reopened,{...feature,id:'later',faces:[{...feature.faces[0],sourceFeatureId:'offset'}]});
 expect(later.features.at(-2)).toEqual(feature);
 expect(featureDependencies(later).get('later')).toContain('offset');
 expect(sourceFeatureForBody(later,body,'later')).toBe('offset');
});
it('tracks all modified parts through source dependencies and later face references',()=>{
 const {doc,source,body,feature}=fixture();
 const second={...source,id:'second',operation:'new' as const,bodyId:'other'};
 let multi=insertFeature(doc,second);feature.faces.push({sourceFeatureId:'second',bodyId:'other',normal:[0,0,1],label:'Other top'});
 multi=insertFeature(multi,feature);
 expect(featureDependencies(multi).get('offset')).toEqual(expect.arrayContaining([source.id,'second']));
 expect(sourceFeatureForBody(multi,body)).toBe('offset');expect(sourceFeatureForBody(multi,'other')).toBe('offset');
 expect(setFeatureSuppressed(multi,'second',true).features.at(-1)?.suppressed).toBe(true);
 expect(()=>moveFeature(multi,'offset',-1)).toThrow();
 const missing=removeFeature(multi,source.id);expect(()=>validatePartDocument(missing)).not.toThrow();
 expect(featureReferenceErrors(missing).get('offset')).toMatch(/Missing reference/);
 expect(translateDocument(missing).untranslated.some(f=>f.id==='offset')).toBe(true);
});
it.each([0,NaN,Infinity])('rejects invalid offset %s',distanceMillimeters=>{
 const {doc,feature}=fixture();expect(()=>insertFeature(doc,{...feature,distanceMillimeters})).toThrow(/offset/i);
});
it.each(['empty','duplicate','normal','source','target','kind'])('rejects malformed face selection %s',mutation=>{
 const {doc,feature}=fixture();const next:any=structuredClone(feature);
 if(mutation==='empty')next.faces=[];
 if(mutation==='duplicate')next.faces.push(next.faces[0]);
 if(mutation==='normal')next.faces[0].normal=[0,0,2];
 if(mutation==='source')next.faces[0].sourceFeatureId=doc.features[0].id;
 if(mutation==='target')next.targetBodyId='other';
 if(mutation==='kind')next.faces[0].surfaceType='cylinder';
 expect(()=>insertFeature(doc,next)).toThrow();
});
