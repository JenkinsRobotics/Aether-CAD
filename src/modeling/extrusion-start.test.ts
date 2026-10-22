import {expect,it} from 'vitest';
import {createEmptyPartDocument,serializePartDocument,type PartDocument} from '@aether/core/document';
import {nativeExtrusionStart,extrusionStartPlanes} from './extrude-start-reference';

function part():PartDocument {
 const doc=createEmptyPartDocument('Referenced start');doc.features.push(
 {id:'datum',name:'Start plane',type:'plane',plane:'XY',offsetMillimeters:10,suppressed:false},
 {id:'s',name:'Circle',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',centerMillimeters:[0,0],radiusMillimeters:2}},
 {id:'e',name:'From datum',type:'extrude',profileFeatureId:'s',operation:'new',bodyId:'solid',distanceMillimeters:5,suppressed:false,startingReference:{kind:'plane',sourceFeatureId:'datum',label:'Start plane'}});return doc;
}
it('resolves nested principal-based datum definitions each time',()=>{
 const doc=part();doc.features.splice(1,0,{id:'nested',name:'Nested',type:'plane',plane:'XY',offsetMillimeters:0,suppressed:false,definition:{method:'offset',reference:{kind:'feature',featureId:'datum'},distanceMillimeters:3}});
 const ref={kind:'plane',sourceFeatureId:'nested',label:'Nested'} as const;
 expect(nativeExtrusionStart(doc,ref,'e')).toMatchObject({frame:{originMillimeters:[0,0,13]}});
 Object.assign(doc.features[0],{offsetMillimeters:20});expect(nativeExtrusionStart(doc,ref,'e')).toMatchObject({frame:{originMillimeters:[0,0,23]}});
});
it.each([{},null,{kind:'principal',plane:'AB',label:'Invalid'},{kind:'plane',sourceFeatureId:'s',label:'Sketch'},
 {kind:'face',sourceFeatureId:'datum',bodyId:'base',normal:[0,0,1],label:'Plane as face'},
 {kind:'face',sourceFeatureId:'missing',bodyId:'base',normal:[0,0,2],label:'Nonunit'}])('rejects malformed starting references %s',ref=>{
 const doc=part();Object.assign(doc.features.at(-1)!,{startingReference:ref});expect(()=>serializePartDocument(doc)).toThrow(/Starting entity/);
});

it('offers only planes before the rollback position',()=>{
 const doc=part();doc.rollbackIndex=0;expect(extrusionStartPlanes(doc)).toHaveLength(3);
 expect(()=>nativeExtrusionStart(doc,{kind:'plane',sourceFeatureId:'datum',label:'Datum'})).toThrow(/unavailable/);
});
