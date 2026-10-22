import {expect,it} from 'vitest';
import {createRectanglePartDocument,insertFeature,type DraftFeature} from '@aether/core/document';
const plate=()=>createRectanglePartDocument('Drafted plate',{widthMillimeters:20,heightMillimeters:20,depthMillimeters:10});
const draft:DraftFeature={id:'draft',type:'draft',name:'Draft',suppressed:false,facePlane:{plane:'XZ',offsetMillimeters:10},neutralPlane:{plane:'XY',offsetMillimeters:0},angleDegrees:5,reversed:false};


it.each([{angleDegrees:0},{angleDegrees:90},{angleDegrees:NaN},{facePlane:{plane:'XY',offsetMillimeters:Infinity}},{neutralPlane:{plane:'bad',offsetMillimeters:0}},{reversed:'yes'}])('rejects invalid Draft intent %j',invalid=>{
  expect(()=>insertFeature(plate(),{...draft,...invalid} as DraftFeature)).toThrow();
});
