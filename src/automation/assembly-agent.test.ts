import {expect,it,vi} from 'vitest';
import {assemblyAgentInteraction,assemblyAgentTools,inspectAssembly} from './assembly-agent';
import type {CADAssemblyController} from '../cad-assembly-controller';

function setup() {
  let key='assembly-a',writable=true;
  const controller={geometryProjection:{assembly_id:'a',revision:'1',part_definitions:[{id:'p',name:'Part',feature_document:{}}],instances:[],mates:[],relations:[],connector_definitions:[],capabilities:{}},
    canUndoRecipe:false,canRedoRecipe:false,editAtomically:vi.fn(async()=>{}),composeRecipe:vi.fn(async()=>({ids:{instances:{one:'i'}},instance_count:1})),undoRecipe:vi.fn(async()=>{})};
  const interaction=assemblyAgentInteraction(controller as unknown as CADAssemblyController,key,()=>key,()=>writable);
  return {controller,interaction,switch:()=>{key='other';},lock:()=>{writable=false;},execute:(name:string,args={})=>interaction.execute({id:'call',name,arguments:{...(name==='aether_cad_assembly_inspect'?{}:{expected_revision:inspectAssembly(controller as unknown as CADAssemblyController).revision}),...args}},new AbortController().signal)};
}
it('offers only implemented assembly tools and bounded recipe input',()=>{
  expect(assemblyAgentTools.map(t=>t.name)).toEqual(['aether_cad_docs','aether_cad_assembly_inspect','aether_cad_assembly_compose','aether_cad_assembly_edit','aether_cad_assembly_undo','aether_cad_assembly_redo']);
  expect(assemblyAgentTools.every(t=>t.inputSchema.additionalProperties===false)).toBe(true);
});
it('inspects reusable template IDs and uses the same controller as the UI',async()=>{
  const f=setup();const inspection=await f.execute('aether_cad_assembly_inspect') as any;
  expect(inspection.example.parts[0]).toEqual({key:'block',part_id:'p'});
  const result=await f.execute('aether_cad_assembly_compose',{recipe_json:JSON.stringify(inspection.example)});
  expect(f.controller.composeRecipe).toHaveBeenCalledWith(inspection.example,expect.any(AbortSignal),expect.any(Function));expect(result).toMatchObject({changed:true,instance_count:1});
  await f.execute('aether_cad_assembly_undo');expect(f.controller.undoRecipe).toHaveBeenLastCalledWith(-1,expect.any(AbortSignal),expect.any(Function));
  await f.execute('aether_cad_assembly_redo');expect(f.controller.undoRecipe).toHaveBeenLastCalledWith(1,expect.any(AbortSignal),expect.any(Function));
});
it.each(['stale','readonly','invalid','oversized','unknown'] as const)('refuses %s without issuing a mutation',async(mode)=>{
  const f=setup();if(mode==='stale')f.switch();if(mode==='readonly')f.lock();
  const call=mode==='unknown'?'aether_cad_assembly_delete':'aether_cad_assembly_compose';
  await expect(f.execute(call,{recipe_json:mode==='invalid'?'{':mode==='oversized'?'x'.repeat(2*1024*1024+1):'{}'})).rejects.toThrow();
  expect(f.controller.composeRecipe).not.toHaveBeenCalled();
});

it('refuses a stale revision and rechecks context after asynchronous work',async()=>{
  const f=setup();
  await expect(f.execute('aether_cad_assembly_compose',{expected_revision:'old',recipe_json:'{}'})).rejects.toThrow(/revision/);
  expect(f.controller.composeRecipe).not.toHaveBeenCalled();
  await f.execute('aether_cad_assembly_compose',{recipe_json:'{}'});
  const guard=(f.controller.composeRecipe.mock.calls[0] as unknown as [unknown,unknown,()=>void])[2];
  f.switch();expect(guard).toThrow(/changed/);
});
it('pages inspection without returning embedded Part geometry',async()=>{
  const f=setup();
  f.controller.geometryProjection.instances=Array.from({length:51},(_,i)=>({id:String(i)})) as never[];
  const first=await f.execute('aether_cad_assembly_inspect',{section:'instances'}) as any;
  expect(first.items).toHaveLength(25);expect(first.next_offset).toBe(25);
  const last=await f.execute('aether_cad_assembly_inspect',{section:'instances',offset:50}) as any;
  expect(last.items).toEqual([{id:'50'}]);expect(last.next_offset).toBeNull();
  const parts=await f.execute('aether_cad_assembly_inspect',{section:'parts'}) as any;
  expect(parts.items[0]).not.toHaveProperty('feature_document');
});

it('pages solution diagnostics as well as placements and DOFs',()=>{
  const f=setup();
  const ids=Array.from({length:26},(_,i)=>String(i));
  const controller={...f.controller,solutionProjection:{status:'invalid',revision:'1',instance_world_transforms:[],dof_values:[],remaining_free_dof_count:0,residual:0,iterations:1,limit_violations:ids.map(id=>({dof_id:id})),diagnostic_ids:ids}} as unknown as CADAssemblyController;
  const first=inspectAssembly(controller,{section:'solution'}) as any;
  expect(first.solution.diagnostic_ids).toHaveLength(25);expect(first.solution.limit_violations).toHaveLength(25);expect(first.next_offset).toBe(25);
  const last=inspectAssembly(controller,{section:'solution',offset:25}) as any;
  expect(last.solution.diagnostic_ids).toEqual(['25']);expect(last.next_offset).toBeNull();
});

it('rejects an old editor token after an archive revision is reused by undo or reopen',async()=>{
  const f=setup();
  const before=await f.execute('aether_cad_assembly_inspect') as any;
  expect(before.source_revision).toBe('1');
  expect((await f.execute('aether_cad_assembly_inspect') as any).revision).toBe(before.revision);
  f.controller.geometryProjection={...f.controller.geometryProjection};
  const after=await f.execute('aether_cad_assembly_inspect') as any;
  expect(after.source_revision).toBe(before.source_revision);expect(after.revision).not.toBe(before.revision);
  await expect(f.execute('aether_cad_assembly_compose',{expected_revision:before.revision,recipe_json:'{}'})).rejects.toThrow(/revision/);
  expect(f.controller.composeRecipe).not.toHaveBeenCalled();
});
