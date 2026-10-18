import {expect,it} from 'vitest';
import {createRectanglePartDocument,insertFeature,availableBodies,bodyIDForFeature,serializePartDocument,parsePartDocument,featureDependencies,featureReferenceErrors,removeFeature,setFeatureSuppressed,type TransformFeature} from '@aether/core/document';
import {translateDocument} from '../freecad-translate';
import {sourceFeatureForBody} from './sketch-support';
import {resolveBodyOutputs} from './body-outputs';
function fixture(copy=true){
 const doc=createRectanglePartDocument('Block',{widthMillimeters:10,heightMillimeters:20,depthMillimeters:5});
 const producer=doc.features.find(f=>f.type==='extrude')!,bodyId=bodyIDForFeature(doc,producer);
 const feature:TransformFeature={id:'transform',type:'transform',name:'Move',suppressed:false,bodyIds:[bodyId],transform:{kind:'translate',translationMillimeters:[10,-5,7]},...(copy?{copyBodyIds:{[bodyId]:'copy'}}:{})};
 return{doc,bodyId,feature,producer};
}
it.each([false,true])('persists transforms and copies with correct body identities, dependencies and translation (%s)',copy=>{
 const{doc,bodyId,feature,producer}=fixture(copy);const next=insertFeature(doc,feature),reopened=parsePartDocument(serializePartDocument(next));
 expect(reopened.features.at(-1)).toEqual(feature);
 expect(availableBodies(next).map(b=>b.id)).toEqual(copy?[bodyId,'copy']:[bodyId]);
 expect(sourceFeatureForBody(next,bodyId)).toBe(copy?producer.id:'transform');
 if(copy)expect(sourceFeatureForBody(next,'copy')).toBe('transform');
 expect(featureDependencies(next).get('transform')).toContain(producer.id);
 expect(translateDocument(next).features.at(-1)).toEqual({id:'transform',kind:'transform',parameters:{body_ids:[bodyId],transform:feature.transform,...(copy?{copy_body_ids:feature.copyBodyIds}:{})}});
 expect(availableBodies(setFeatureSuppressed(next,'transform',true)).map(b=>b.id)).toEqual([bodyId]);
 expect(featureReferenceErrors(removeFeature(next,producer.id)).has('transform')).toBe(true);
});
it('pins a copied output for later operations and never changes the source body',()=>{
 const{doc,feature,producer}=fixture();let next=insertFeature(doc,feature);
 next=insertFeature(next,{id:'finish',type:'offset-face',name:'Offset',suppressed:false,distanceMillimeters:1,faces:[{bodyId:'copy',sourceFeatureId:'transform',label:'Top',normal:[0,0,1]}]});
 expect(featureDependencies(next).get('finish')).toContain('transform');
 expect(next.features.find(f=>f.id==='transform')).toEqual(feature);
 expect(availableBodies(setFeatureSuppressed(next,producer.id,true))).toEqual([]);
 expect(resolveBodyOutputs(next,{transform:['copy']})).toEqual(next);
 for(const outputs of [{},{transform:[]},{transform:['wrong']},{transform:['copy','copy']}] as Record<string,string[]>[])expect(()=>resolveBodyOutputs(next,outputs)).toThrow();
});
it.each(['empty','duplicate','existing-output','duplicate-output','bad-vector','zero-axis','negative-scale','overflow-scale','underflow-scale','identity-copy','duplicate-target'])('rejects invalid transform %s',kind=>{
 const{doc,feature,bodyId}=fixture();const f:any=structuredClone(feature);
 if(kind==='empty')f.bodyIds=[];
 if(kind==='duplicate')f.bodyIds.push(bodyId);
 if(kind==='existing-output')f.copyBodyIds[bodyId]=bodyId;
 if(kind==='duplicate-output')f.copyBodyIds.extra='copy';
 if(kind==='bad-vector')f.transform.translationMillimeters=[1,NaN,3];
 if(kind==='zero-axis')f.transform={kind:'rotate',axisOriginMillimeters:[0,0,0],axisDirection:[0,0,0],angleDegrees:30};
 if(kind==='negative-scale')f.transform={kind:'scale',centerMillimeters:[0,0,0],scaleFactors:[1,-1,1]};
 if(kind==='overflow-scale')f.transform={kind:'scale',centerMillimeters:[0,0,0],scaleFactors:[1e200,1e200,1e200]};
 if(kind==='underflow-scale')f.transform={kind:'scale',centerMillimeters:[0,0,0],scaleFactors:[1e-200,1e-200,1e-200]};
 if(kind==='identity-copy'){f.transform={kind:'copy'};delete f.copyBodyIds;}
 if(kind==='duplicate-target')f.targetBodyId=bodyId;
 expect(()=>insertFeature(doc,f)).toThrow();
});
