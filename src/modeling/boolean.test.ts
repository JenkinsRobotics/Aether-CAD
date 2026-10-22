import {expect,it} from 'vitest';
import {createEmptyPartDocument,insertFeature,type BooleanFeature} from '@aether/core/document';
function part() {
  let doc=createEmptyPartDocument('Boolean');
  for (const [key,x] of [['target',0],['tool',5],['other',30]] as const) {
    doc=insertFeature(doc,{id:`${key}-sketch`,type:'profile',name:key,suppressed:false,plane:'XY',offsetMillimeters:0,profile:{type:'polygon',pointsMillimeters:[[x,0],[x+10,0],[x+10,10],[x,10]]}});
    doc=insertFeature(doc,{id:`${key}-pad`,type:'extrude',name:key,suppressed:false,profileFeatureId:`${key}-sketch`,distanceMillimeters:10,operation:'new',bodyId:key});
  }
  return doc;
}
const boolean:BooleanFeature={id:'boolean',type:'boolean',name:'Combine',suppressed:false,operation:'union',targetBodyId:'target',toolBodyIds:['tool'],keepTools:false};
it.each([{operation:'bad'},{targetBodyId:''},{toolBodyIds:[]},{toolBodyIds:['target']},{toolBodyIds:['tool','tool']},{toolBodyIds:[2]},{keepTools:'false'}])('rejects invalid Boolean intent %j',invalid=>{
  expect(()=>insertFeature(part(),{...boolean,...invalid} as BooleanFeature)).toThrow();
});
