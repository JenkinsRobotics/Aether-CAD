import {expect,it} from 'vitest';
import {createRectanglePartDocument,bodyIDForFeature,insertFeature,type OffsetFaceFeature} from '@aether/core/document';

function fixture(){
 const doc=createRectanglePartDocument('Block',{widthMillimeters:10,heightMillimeters:20,depthMillimeters:10});
 const source=doc.features.find(f=>f.type==='extrude')!,body=bodyIDForFeature(doc,source);
 const feature:OffsetFaceFeature={id:'offset',type:'offset-face',name:'Offset faces',suppressed:false,distanceMillimeters:-1,
  faces:[{sourceFeatureId:source.id,bodyId:body,normal:[0,0,1],label:'Top'}]};
 return {doc,source,body,feature};
}
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
