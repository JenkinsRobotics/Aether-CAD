import {describe,expect,it} from 'vitest';
import {appendSolidPrimitive,defaultPrimitiveDimensions as defaults,type SolidPrimitive} from './solid-primitives';
import {parsePartDocument,serializePartDocument} from '@aether/core/document';
describe('editable solid primitives',()=>{
 for(const kind of ['box','cylinder','cone','sphere','torus'] as SolidPrimitive[]) it(`creates ${kind} with a canonical editable history`,()=>{
  const doc=appendSolidPrimitive(null,kind,defaults);
  expect(doc.features.map(f=>f.type)).toEqual(['profile',kind==='box'||kind==='cylinder'?'extrude':'revolve']);
  expect(parsePartDocument(serializePartDocument(doc))).toEqual(doc);
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
});
