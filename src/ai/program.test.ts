import {expect,it} from 'vitest';
import {availableBodies,createEmptyPartDocument} from '@aether/core/document';
import {executeProgram,plateProgram} from './program';
import {discoverCAD} from './knowledge';
import {cadAgentTools} from '../automation/live-commands';

it('builds a referenced plate through ordinary editable features without touching the source',async()=>{
  const source=createEmptyPartDocument('Plate');
  const result=await executeProgram(source,JSON.stringify(plateProgram),async doc=>doc);
  expect(source.features).toHaveLength(0);expect(result.document.features).toHaveLength(2);
  expect(result.document.features[1]).toMatchObject({type:'extrude',profileFeatureId:result.references.outline.feature_id,distanceMillimeters:10});
  expect(availableBodies(result.document).map(b=>b.id)).toEqual([result.references.plate.body_id]);
});
it.each([
  {version:2,steps:plateProgram.steps},
  {version:1,steps:[]},
  {version:1,steps:Array.from({length:17},(_,i)=>({...plateProgram.steps[0],id:`s${i}`}))},
  {version:1,steps:[plateProgram.steps[1]]},
  {version:1,steps:[plateProgram.steps[0],plateProgram.steps[0]]},
  {version:1,steps:[{id:'undo',tool:'aether_cad_undo',arguments:{}}]},
  {version:1,steps:[{id:'nested',tool:'aether_cad_run_program',arguments:{}}]},
  {version:1,steps:[{...plateProgram.steps[0],id:'__proto__'}]},
  {version:1,steps:[plateProgram.steps[0],{...plateProgram.steps[1],arguments:{profile_id:{$ref:'outline.body_id'},operation:'new',depth_mm:10}}]},
  {...plateProgram,unexpected:true},
])('rejects malformed or unsupported programs atomically',async program=>{
  const source=createEmptyPartDocument('Unchanged'),before=JSON.stringify(source);
  await expect(executeProgram(source,JSON.stringify(program),async doc=>doc)).rejects.toThrow();expect(JSON.stringify(source)).toBe(before);
});
it('bounds program bytes before parsing',async()=>expect(executeProgram(createEmptyPartDocument('Part'),' '.repeat(65537),async doc=>doc)).rejects.toThrow(/64 KiB/));
it('discovers real schemas, pages results and supplies an executable example',async()=>{
  const docs=discoverCAD(cadAgentTools,{name:'aether_cad_run_program'},'part');
  expect(docs.tools).toEqual([cadAgentTools.find(t=>t.name==='aether_cad_run_program')]);
  expect((await executeProgram(createEmptyPartDocument('Part'),docs.example!.arguments.program_json,async doc=>doc)).document.features).toHaveLength(2);
  const search=discoverCAD(cadAgentTools,{query:'cone'},'part');expect(search.tools.some(t=>t.name==='aether_cad_solid_primitive')).toBe(true);
  expect(discoverCAD(cadAgentTools,{name:'classcad_api'},'part').tools).toEqual([]);
  expect(discoverCAD(cadAgentTools,{},'part').next_offset).toBe(5);
  expect(()=>discoverCAD(cadAgentTools,{offset:-1},'part')).toThrow();
});
