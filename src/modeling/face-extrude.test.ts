import {expect,it} from 'vitest';
import {createRectanglePartDocument,insertFeature,parsePartDocument,serializePartDocument,featureReferenceErrors,setFeatureSuppressed,validatePartDocument,type FaceExtrudeFeature} from '@aether/core/document';
import {translateDocument} from '../freecad-translate';
function fixture(){
 const doc=createRectanglePartDocument('Block',{widthMillimeters:10,heightMillimeters:20,depthMillimeters:10});
 const source=doc.features.find(f=>f.type==='extrude')!;
 const body=translateDocument(doc).features.find(f=>f.id===source.id)!.parameters.body_id as string;
 const feature:FaceExtrudeFeature={id:'pull',type:'face-extrude',name:'Push/Pull',suppressed:false,sourceFeatureId:source.id,targetBodyId:body,normal:[0,0,1],faceLabel:'Top',distanceMillimeters:5};
 return {doc,feature};
}
it('roundtrips a native face feature and translates its exact signed parameters',()=>{
 const {doc,feature}=fixture();feature.distanceMillimeters=-3;
 feature.faceAnchor={centerMillimeters:[5,10,10],areaSquareMillimeters:200};
 const reopened=parsePartDocument(serializePartDocument(insertFeature(doc,feature)));
 expect(reopened.features.at(-1)).toEqual(feature);
 expect(translateDocument(reopened).features.at(-1)).toMatchObject({id:'pull',kind:'face-extrude',parameters:{body_id:feature.targetBodyId,source_feature_id:feature.sourceFeatureId,distance_mm:-3,normal:[0,0,1],operation:'cut',face_anchor:feature.faceAnchor}});
});
it.each([null,{}, {centerMillimeters:[1,2],areaSquareMillimeters:5}, {centerMillimeters:[1,2,3],areaSquareMillimeters:0},{centerMillimeters:[1,NaN,3],areaSquareMillimeters:5}])('rejects malformed planar anchors %j',faceAnchor=>{
 const {doc,feature}=fixture();expect(()=>insertFeature(doc,{...feature,faceAnchor} as FaceExtrudeFeature)).toThrow(/anchor/);
});
it.each([0,NaN,Infinity])('rejects invalid depth %s',distance=>{
 const {doc,feature}=fixture();expect(()=>insertFeature(doc,{...feature,distanceMillimeters:distance})).toThrow(/distance/);
});
it('rejects non-unit normals and non-solid sources',()=>{
 const {doc,feature}=fixture();expect(()=>insertFeature(doc,{...feature,normal:[0,0,2]})).toThrow(/normal/);
 expect(()=>insertFeature(doc,{...feature,sourceFeatureId:doc.features[0].id})).toThrow(/solid feature/);
});
it('keeps deleted references recoverable and cascades source suppression',()=>{
 const {doc,feature}=fixture();const saved=insertFeature(doc,feature);
 const suppressed=setFeatureSuppressed(saved,feature.sourceFeatureId,true);
 expect(suppressed.features.at(-1)!.suppressed).toBe(true);
 const missing={...saved,features:saved.features.filter(f=>f.id!==feature.sourceFeatureId)};
 expect(()=>validatePartDocument(missing)).not.toThrow();
 expect(featureReferenceErrors(missing).get('pull')).toMatch(/Missing reference/);
 expect(translateDocument(missing).untranslated.some(f=>f.id==='pull')).toBe(true);
});
