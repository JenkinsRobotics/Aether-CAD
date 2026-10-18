import {expect,it} from 'vitest';
import {createRectanglePartDocument,parsePartDocument,serializePartDocument,insertFeature,availableBodies,type DraftFeature} from '@aether/core/document';
import {translateDocument} from '../freecad-translate';
const plate=()=>createRectanglePartDocument('Drafted plate',{widthMillimeters:20,heightMillimeters:20,depthMillimeters:10});
const draft:DraftFeature={id:'draft',type:'draft',name:'Draft',suppressed:false,facePlane:{plane:'XZ',offsetMillimeters:10},neutralPlane:{plane:'XY',offsetMillimeters:0},angleDegrees:5,reversed:false};

it('persists and translates geometric Draft references without saved FaceN indices',()=>{
  const doc=insertFeature(plate(),draft);
  const reopened=parsePartDocument(serializePartDocument(doc));
  expect(reopened.features.at(-1)).toMatchObject(draft);
  const result=translateDocument(reopened);
  expect(result.untranslated).toEqual([]);
  expect(result.features.at(-1)).toMatchObject({kind:'draft',parameters:{body_id:availableBodies(doc)[0].id,face_plane:'XZ',face_offset_mm:10,neutral_plane:'XY',neutral_offset_mm:0,angle_deg:5,reversed:false}});
});

it.each([{angleDegrees:0},{angleDegrees:90},{angleDegrees:NaN},{facePlane:{plane:'XY',offsetMillimeters:Infinity}},{neutralPlane:{plane:'bad',offsetMillimeters:0}},{reversed:'yes'}])('rejects invalid Draft intent %j',invalid=>{
  expect(()=>insertFeature(plate(),{...draft,...invalid} as DraftFeature)).toThrow();
});
