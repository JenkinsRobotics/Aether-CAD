import {expect,it} from 'vitest';
import {createRectanglePartDocument,insertFeature,featureReferenceErrors,setFeatureSuppressed,validatePartDocument,type ExtrudeFeature} from '@aether/core/document';
import {translateDocument} from '../freecad-translate';
function fixture(){
 const doc=createRectanglePartDocument('Reference',{widthMillimeters:10,heightMillimeters:20,depthMillimeters:10});
 const source=doc.features.find(f=>f.type==='extrude')!;
 const feature:ExtrudeFeature={id:'result',type:'extrude',name:'Referenced',suppressed:false,profileFeatureId:doc.features[0].id,distanceMillimeters:1,operation:'new',endType:'up-to-face',endReference:{sourceFeatureId:source.id,bodyId:'body',normal:[0,0,1],label:'Top'}};
 return {doc,feature};
}
it('keeps a deleted stop repairable and cascades suppression of its source',()=>{
 const {doc,feature}=fixture();const saved=insertFeature(doc,feature);
 expect(setFeatureSuppressed(saved,feature.endReference!.sourceFeatureId,true).features.at(-1)!.suppressed).toBe(true);
 const missing={...saved,features:saved.features.filter(f=>f.id!==feature.endReference!.sourceFeatureId)};
 expect(()=>validatePartDocument(missing)).not.toThrow();
 expect(featureReferenceErrors(missing).get('result')).toMatch(/Missing reference/);
 expect(translateDocument(missing).untranslated.some(f=>f.id==='result')).toBe(true);
});
it('rejects invalid and forward stopping references before native evaluation',()=>{
 const {doc,feature}=fixture();
 for(const reference of [undefined,{...feature.endReference,normal:[0,0,2]},{...feature.endReference,bodyId:' '},{...feature.endReference,label:''},{...feature.endReference,sourceFeatureId:doc.features[0].id}])
  expect(()=>insertFeature(doc,{...feature,endReference:reference} as ExtrudeFeature)).toThrow(/face reference|planar normal/);
 const forward={...doc,features:[doc.features[0],feature,doc.features[1]]};
 expect(()=>validatePartDocument(forward)).toThrow(/face reference|planar normal/);
});
it('preserves and validates the stopping face anchor',()=>{
 const {doc,feature}=fixture();const faceAnchor={centerMillimeters:[5,10,10] as [number,number,number],areaSquareMillimeters:200};
 feature.endReference!.faceAnchor=faceAnchor;
 const saved=insertFeature(doc,feature);
 expect(translateDocument(saved).features.at(-1)?.parameters.end_reference).toMatchObject({faceAnchor});
 expect(()=>insertFeature(doc,{...feature,endReference:{...feature.endReference!,faceAnchor:{...faceAnchor,areaSquareMillimeters:NaN}}})).toThrow(/anchor/);
});
