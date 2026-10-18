import {expect,it} from 'vitest';
import {createRectanglePartDocument,bodyIDForFeature,insertFeature,parsePartDocument,serializePartDocument,featureReferenceErrors,setFeatureSuppressed,type ExtrudeFeature} from '@aether/core/document';
import {translateDocument} from '../freecad-translate';
function fixture(){
 const doc=createRectanglePartDocument('Curved reference',{widthMillimeters:10,heightMillimeters:20,depthMillimeters:10});
 const source=doc.features.find(f=>f.type==='extrude')!;
 const reference={sourceFeatureId:source.id,bodyId:bodyIDForFeature(doc,source),surfaceType:'cylinder' as const,label:'Cylinder'};
 const feature:ExtrudeFeature={id:'e',type:'extrude',name:'End at cylinder',bodyId:'result',profileFeatureId:doc.features[0].id,endType:'up-to-face',endReference:reference,distanceMillimeters:1,operation:'new',draftAngleDegrees:3,suppressed:false};
 return {doc,feature,reference};
}
it.each([false,true])('preserves curved stopping references, native translation and history on either end (%s)',opposite=>{
 const {doc,feature,reference}=fixture();
 if(opposite){delete feature.endReference;feature.endType='blind';feature.secondEnd={endType:'up-to-face',distanceMillimeters:1,endReference:reference,endOffsetMillimeters:2,draftAngleDegrees:-3};}
 const saved=parsePartDocument(serializePartDocument(insertFeature(doc,feature)));
 expect(saved.features.at(-1)).toEqual(feature);
 const p=translateDocument(saved).features.at(-1)!.parameters;
 expect(opposite?(p.second_end as any).end_reference:p.end_reference).toEqual(reference);
 expect(setFeatureSuppressed(saved,reference.sourceFeatureId,true).features.at(-1)!.suppressed).toBe(true);
 const missing={...saved,features:saved.features.filter(f=>f.id!==reference.sourceFeatureId)};
 expect(featureReferenceErrors(missing).get('e')).toMatch(/Missing reference/);
 expect(translateDocument(missing).untranslated.some(f=>f.id==='e')).toBe(true);
});
it.each([{surfaceType:'unknown'},{surfaceType:'cylinder',normal:[0,0,1]},{surfaceType:'cylinder',faceAnchor:{centerMillimeters:[0,0,0],areaSquareMillimeters:0}},{surfaceType:'cylinder',bodyId:''}])('rejects malformed curved references %j',patch=>{
 const {doc,feature,reference}=fixture();expect(()=>insertFeature(doc,{...feature,endReference:{...reference,...patch}} as any)).toThrow();
});
