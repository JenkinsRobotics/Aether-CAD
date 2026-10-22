import {expect,it} from 'vitest';
import {bodyIDForFeature,createRectanglePartDocument,insertFeature,serializePartDocument,type PartDocument} from '@aether/core/document';
// The move-face translation contract went with the FreeCAD translator; the engine builds the
// feature (oracle: move-face-* fixtures). What stays is the document's own validation.
function model(transform:unknown):PartDocument {
 const doc=createRectanglePartDocument('Block',{widthMillimeters:10,heightMillimeters:20,depthMillimeters:10});
 const source=doc.features.find(f=>f.type==='extrude')!;
 return insertFeature(doc,{id:'move',type:'offset-face',name:'Move face',suppressed:false,faces:[{sourceFeatureId:source.id,bodyId:bodyIDForFeature(doc,source),normal:[0,0,1],label:'Top'}],transform} as never);
}
it.each(['both','copy','scale','axis','angle','move'])('rejects invalid face transform %s',bad=>{
 const doc=model({kind:'rotate',axisOriginMillimeters:[0,0,0],axisDirection:[1,0,0],angleDegrees:15}),f:any=doc.features.at(-1);
 if(bad==='both')f.distanceMillimeters=2;if(bad==='copy')f.transform={kind:'copy'};if(bad==='scale')f.transform={kind:'scale',scaleFactors:[2,2,2],centerMillimeters:[0,0,0]};if(bad==='axis')f.transform.axisDirection=[0,0,0];if(bad==='angle')f.transform.angleDegrees=NaN;if(bad==='move')f.transform={kind:'translate',translationMillimeters:[0,Infinity,0]};
 expect(()=>serializePartDocument(doc)).toThrow();
});
