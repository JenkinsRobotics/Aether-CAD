import {expect,it} from 'vitest';
import {createRectanglePartDocument,insertFeature,validatePartDocument,type ExtrudeFeature} from '@aether/core/document';
function fixture(){
 const doc=createRectanglePartDocument('Reference',{widthMillimeters:10,heightMillimeters:20,depthMillimeters:10});
 const source=doc.features.find(f=>f.type==='extrude')!;
 const feature:ExtrudeFeature={id:'result',type:'extrude',name:'Referenced',suppressed:false,profileFeatureId:doc.features[0].id,distanceMillimeters:1,operation:'new',endType:'up-to-face',endReference:{sourceFeatureId:source.id,bodyId:'body',normal:[0,0,1],label:'Top'}};
 return {doc,feature};
}
it('rejects invalid and forward stopping references before native evaluation',()=>{
 const {doc,feature}=fixture();
 for(const reference of [undefined,{...feature.endReference,normal:[0,0,2]},{...feature.endReference,bodyId:' '},{...feature.endReference,label:''},{...feature.endReference,sourceFeatureId:doc.features[0].id}])
  expect(()=>insertFeature(doc,{...feature,endReference:reference} as ExtrudeFeature)).toThrow(/face reference|planar normal/);
 const forward={...doc,features:[doc.features[0],feature,doc.features[1]]};
 expect(()=>validatePartDocument(forward)).toThrow(/face reference|planar normal/);
});
