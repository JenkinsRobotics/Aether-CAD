import {expect,it} from 'vitest';
import {createRectanglePartDocument,insertFeature,bodyIDForFeature,serializePartDocument,parsePartDocument,featureDependencies,moveFeature,setFeatureSuppressed,type SolidEdgeReference} from '@aether/core/document';
import {translateDocument} from '../freecad-translate';
const anchor=(z:number)=>({positionMillimeters:[10,20,z] as [number,number,number],signature:'native-'+z,incidence:'incidence-'+z,shapeFingerprint:'a'.repeat(64)});
function model(kind:'translate-reference'|'rotate-reference'='translate-reference') {
 const doc=createRectanglePartDocument('Edge',{widthMillimeters:10,heightMillimeters:20,depthMillimeters:5}),base=doc.features.at(-1)!;
 const body=bodyIDForFeature(doc,base);
 const reference:SolidEdgeReference={kind:'solid-edge',sourceFeatureId:base.id,bodyId:body,label:'Edge',anchor:{start:anchor(0),end:anchor(5)}};
 return insertFeature(doc,{id:'move',type:'transform',name:'Edge transform',bodyIds:[body],suppressed:false,transform:kind==='translate-reference'?{kind,reference,distanceMillimeters:-15,reversed:true}:{kind,reference,angleDegrees:90}});
}
it.each(['translate-reference','rotate-reference'] as const)('roundtrips %s edge identity, preserves history and defers native resolution',kind=>{
 const doc=model(kind),base=doc.features[1],restored=parsePartDocument(serializePartDocument(doc));
 expect(restored.features).toEqual(doc.features);expect(featureDependencies(doc).get('move')).toContain(base.id);
 expect(()=>moveFeature(doc,base.id,1)).toThrow();expect(setFeatureSuppressed(doc,base.id,true).features.at(-1)?.suppressed).toBe(true);
 const translated=translateDocument(restored);expect(translated.untranslated).toEqual([]);
 expect(translated.features.at(-1)?.parameters.transform).toEqual((doc.features.at(-1) as any).transform);
});
it.each(['anchor','start','zero-length','fingerprint','signature','incidence','non-finite','source-type','future','body','label'])('rejects invalid %s edge references before saving',bad=>{
 const doc=model(),ref=(doc.features.at(-1) as any).transform.reference;
 if(bad==='anchor')delete ref.anchor;if(bad==='start')delete ref.anchor.start;
 if(bad==='zero-length')ref.anchor.end=structuredClone(ref.anchor.start);
 if(bad==='fingerprint')ref.anchor.end.shapeFingerprint='b'.repeat(64);
 if(bad==='signature')ref.anchor.start.signature='';if(bad==='incidence')ref.anchor.start.incidence='';
 if(bad==='non-finite')ref.anchor.start.positionMillimeters[0]=Infinity;
 if(bad==='source-type')ref.sourceFeatureId=doc.features[0].id;
 if(bad==='future')doc.features.push(doc.features.splice(1,1)[0]);
 if(bad==='body')ref.bodyId='';if(bad==='label')ref.label='';
 expect(()=>serializePartDocument(doc)).toThrow();
});
it('retains a deleted source for repair but never translates it as numeric geometry',()=>{
 const doc=model();doc.features.splice(1,1);expect(parsePartDocument(serializePartDocument(doc))).toEqual(doc);
 expect(translateDocument(doc).untranslated.some(f=>f.id==='move')).toBe(true);
});
