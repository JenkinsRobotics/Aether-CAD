import {expect,it,vi} from 'vitest';
import {assemblyAgentInteraction,assemblyAgentTools} from './assembly-agent';
import type {CADAssemblyController} from '../cad-assembly-controller';

function setup() {
  let key='assembly-a',writable=true;
  const controller={geometryProjection:{assembly_id:'a',revision:'1',part_definitions:[{id:'p',name:'Part',feature_document:{}}],instances:[],mates:[]},
    canUndoRecipe:false,canRedoRecipe:false,composeRecipe:vi.fn(async()=>({ids:{instances:{one:'i'}},instance_count:1})),undoRecipe:vi.fn(async()=>{})};
  const interaction=assemblyAgentInteraction(controller as unknown as CADAssemblyController,key,()=>key,()=>writable);
  return {controller,interaction,switch:()=>{key='other';},lock:()=>{writable=false;},execute:(name:string,args={})=>interaction.execute({id:'call',name,arguments:args},new AbortController().signal)};
}
it('offers only implemented assembly tools and bounded recipe input',()=>{
  expect(assemblyAgentTools.map(t=>t.name)).toEqual(['aether_cad_docs','aether_cad_assembly_inspect','aether_cad_assembly_compose','aether_cad_assembly_undo','aether_cad_assembly_redo']);
  expect(assemblyAgentTools.every(t=>t.inputSchema.additionalProperties===false)).toBe(true);
});
it('inspects reusable template IDs and uses the same controller as the UI',async()=>{
  const f=setup();const inspection=await f.execute('aether_cad_assembly_inspect') as any;
  expect(inspection.example.parts[0]).toEqual({key:'block',part_id:'p'});
  const result=await f.execute('aether_cad_assembly_compose',{recipe_json:JSON.stringify(inspection.example)});
  expect(f.controller.composeRecipe).toHaveBeenCalledWith(inspection.example,expect.any(AbortSignal));expect(result).toMatchObject({changed:true,instance_count:1});
  await f.execute('aether_cad_assembly_undo');expect(f.controller.undoRecipe).toHaveBeenLastCalledWith(-1,expect.any(AbortSignal));
  await f.execute('aether_cad_assembly_redo');expect(f.controller.undoRecipe).toHaveBeenLastCalledWith(1,expect.any(AbortSignal));
});
it.each(['stale','readonly','invalid','oversized','unknown'] as const)('refuses %s without issuing a mutation',async(mode)=>{
  const f=setup();if(mode==='stale')f.switch();if(mode==='readonly')f.lock();
  const call=mode==='unknown'?'aether_cad_assembly_delete':'aether_cad_assembly_compose';
  await expect(f.execute(call,{recipe_json:mode==='invalid'?'{':mode==='oversized'?'x'.repeat(2*1024*1024+1):'{}'})).rejects.toThrow();
  expect(f.controller.composeRecipe).not.toHaveBeenCalled();
});
