import {expect,it} from 'vitest';
import {createEmptyPartDocument,serializePartDocument,featureDependencies,setFeatureSuppressed,removeFeature,featureReferenceErrors,type PartDocument} from '@aether/core/document';

function part():PartDocument {
 const doc=createEmptyPartDocument('Selected stopping part');doc.features.push(
 {id:'limit-s',type:'profile',name:'Limit sketch',plane:'XY',offsetMillimeters:20,suppressed:false,profile:{type:'circle',radiusMillimeters:20,centerMillimeters:[0,0]}},
 {id:'limit',type:'extrude',name:'Limit',profileFeatureId:'limit-s',distanceMillimeters:3,bodyId:'stop',operation:'new',suppressed:false},
 {id:'s',type:'profile',name:'Profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',radiusMillimeters:2,centerMillimeters:[0,0]}},
 {id:'e',type:'extrude',name:'To part',profileFeatureId:'s',distanceMillimeters:1,endType:'up-to-part',endPartId:'stop',endOffsetMillimeters:2,bodyId:'result',operation:'new',suppressed:false});return doc;
}
it('depends on the latest evaluated stopping-part modifier and handles suppression/deletion',()=>{
 const doc=part();doc.features.splice(2,0,{id:'modifier',type:'extrude',name:'Change stop',profileFeatureId:'limit-s',distanceMillimeters:3,targetBodyId:'stop',operation:'add',suppressed:false});
 expect(featureDependencies(doc).get('e')).toContain('modifier');
 expect(setFeatureSuppressed(doc,'limit',true).features.find(f=>f.id==='e')?.suppressed).toBe(true);
 const missing=structuredClone(doc);missing.features=missing.features.filter(f=>f.id!=='modifier'&&f.id!=='limit');
 expect(()=>serializePartDocument(missing)).not.toThrow();expect(featureReferenceErrors(missing).has('e')).toBe(true);
 expect(featureReferenceErrors(removeFeature(doc,'limit')).has('e')).toBe(true);
});
it.each([undefined,'',true,{},'x'.repeat(257)])('rejects malformed stopping-part identity %s',endPartId=>{
 const doc=part();Object.assign(doc.features.at(-1)!,{endPartId});expect(()=>serializePartDocument(doc)).toThrow(/stopping part identity/);
});
it('rejects a dormant part reference under another mode',()=>{const doc=part();Object.assign(doc.features.at(-1)!,{endType:'blind'});expect(()=>serializePartDocument(doc)).toThrow(/stopping part requires/);});
