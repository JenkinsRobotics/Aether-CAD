import {expect,it} from 'vitest';
import {createEmptyPartDocument,insertFeature,type PatternFeature} from '@aether/core/document';
function part() {
  let doc=createEmptyPartDocument('Pattern');
  doc=insertFeature(doc,{id:'base',type:'profile',name:'Base',suppressed:false,plane:'XY',offsetMillimeters:0,profile:{type:'circle',radiusMillimeters:10,centerMillimeters:[0,0]}});
  doc=insertFeature(doc,{id:'pad',type:'extrude',name:'Plate',suppressed:false,profileFeatureId:'base',distanceMillimeters:10,operation:'new',bodyId:'plate'});
  doc=insertFeature(doc,{id:'center',type:'profile',name:'Center',suppressed:false,plane:'XY',offsetMillimeters:10,profile:{type:'circle',radiusMillimeters:1,centerMillimeters:[5,0]}});
  return insertFeature(doc,{id:'hole',type:'hole',name:'Pilot hole',suppressed:false,profileFeatureId:'center',diameterMillimeters:2,depthMillimeters:10,depthType:'through-all',cutType:'plain',targetBodyId:'plate'});
}
const pattern:PatternFeature={id:'pattern',type:'pattern',name:'Bolt circle',suppressed:false,sourceFeatureId:'hole',targetBodyId:'plate',patternType:'polar',axis:'Z',count:4,angleDegrees:360,reversed:false};
it.each([{count:1},{count:2.5},{axis:'bad'},{angleDegrees:0},{angleDegrees:361},{sourceFeatureId:'center'},{patternType:'linear',spacingMillimeters:0},{reversed:'false'}])('rejects invalid pattern intent %j',invalid=>{
  expect(()=>insertFeature(part(),{...pattern,...invalid} as PatternFeature)).toThrow();
});
