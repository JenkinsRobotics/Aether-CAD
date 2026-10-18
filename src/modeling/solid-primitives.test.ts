import {describe,expect,it} from 'vitest';
import {appendSolidPrimitive,defaultPrimitiveDimensions as defaults,type SolidPrimitive} from './solid-primitives';
import {parsePartDocument,serializePartDocument} from '@aether/core/document';
import {translateDocument} from '../freecad-translate';
describe('editable solid primitives',()=>{
 for(const kind of ['box','cylinder','cone','sphere','torus'] as SolidPrimitive[]) it(`creates ${kind} with a canonical editable history`,()=>{
  const doc=appendSolidPrimitive(null,kind,defaults);
  expect(doc.features.map(f=>f.type)).toEqual(['profile',kind==='box'||kind==='cylinder'?'extrude':'revolve']);
  expect(parsePartDocument(serializePartDocument(doc))).toEqual(doc);
  expect(translateDocument(doc).untranslated).toEqual([]);
  const next=appendSolidPrimitive(doc,kind,defaults);
  expect(doc.features).toHaveLength(2);expect(next.features).toHaveLength(4);
  expect(new Set(next.features.map(f=>f.id)).size).toBe(4);
 });
 it('refuses invalid dimensions and a self-intersecting torus',()=>{
  expect(()=>appendSolidPrimitive(null,'box',{...defaults,height:0})).toThrow(/positive/);
  expect(()=>appendSolidPrimitive(null,'sphere',{...defaults,radius:NaN})).toThrow(/positive/);
  expect(()=>appendSolidPrimitive(null,'torus',{...defaults,tubeRadius:10})).toThrow(/smaller/);
  expect(()=>appendSolidPrimitive(null,'cone',{...defaults,height:0})).toThrow(/positive/);
  expect(()=>appendSolidPrimitive(null,'invalid' as SolidPrimitive,defaults)).toThrow(/Unknown/);
 });
 it('constructs a cone from an axial triangle, so its profile and revolve remain editable',()=>{
  const doc=appendSolidPrimitive(null,'cone',{...defaults,radius:6,height:15});
  expect(doc.features[0]).toMatchObject({type:'profile',plane:'XZ',profile:{type:'polygon',pointsMillimeters:[[0,0],[6,0],[0,15]]}});
  expect(doc.features[1]).toMatchObject({type:'revolve',axis:'Z',angleDegrees:360,profileFeatureId:doc.features[0].id});
  expect(translateDocument(doc).complete).toBe(true);
 });
});
