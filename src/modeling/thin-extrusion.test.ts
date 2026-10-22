import {expect,it} from 'vitest';
import {createEmptyPartDocument,serializePartDocument,type PartDocument} from '@aether/core/document';


export function thinPart():PartDocument {
 const doc=createEmptyPartDocument('Thin wall');doc.features.push(
  {id:'s',type:'profile',name:'Open sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{id:'path',type:'path',start:[0,0],segments:[{id:'line',type:'line',end:[20,0]}]},{id:'ignore',type:'path',construction:true,start:[0,5],segments:[{type:'line',end:[20,5]}]}]}},
  {id:'e',type:'extrude',name:'Wall',profileFeatureId:'s',profileContourId:'path',distanceMillimeters:10,operation:'new',bodyId:'wall',thin:{thickness1Millimeters:2,thickness2Millimeters:1},suppressed:false});return doc;
}
it.each([null,{}, {thickness1Millimeters:0,thickness2Millimeters:0},{thickness1Millimeters:-1,thickness2Millimeters:2},{thickness1Millimeters:true,thickness2Millimeters:2},{thickness1Millimeters:1,thickness2Millimeters:2,midplane:true},{thickness1Millimeters:1,thickness2Millimeters:2,flipped:'yes'}])('refuses invalid thin state %#',thin=>{
 const doc=thinPart();Object.assign(doc.features.at(-1)!,{thin});expect(()=>serializePartDocument(doc)).toThrow(/Thin extrusion/);
});
