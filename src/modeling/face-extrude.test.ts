import {expect,it} from 'vitest';
import {bodyIDForFeature,createRectanglePartDocument,insertFeature,type FaceExtrudeFeature} from '@aether/core/document';
function fixture(){
 const doc=createRectanglePartDocument('Block',{widthMillimeters:10,heightMillimeters:20,depthMillimeters:10});
 const source=doc.features.find(f=>f.type==='extrude')!;
 const body=bodyIDForFeature(doc,source);
 const feature:FaceExtrudeFeature={id:'pull',type:'face-extrude',name:'Push/Pull',suppressed:false,sourceFeatureId:source.id,targetBodyId:body,normal:[0,0,1],faceLabel:'Top',distanceMillimeters:5};
 return {doc,feature};
}
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
