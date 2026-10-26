import {expect,it} from 'vitest';
import {cadReadOnlyInteraction} from './read-only-tools';
import {cadAgentTools} from '../automation/live-commands';
import {assemblyAgentTools} from '../automation/assembly-agent';
import {drawingAgentTools} from '../automation/drawing-agent';

it('classifies inspection separately from Part, Assembly, Drawing and review mutations',()=>{
 const tools=[...cadAgentTools,...assemblyAgentTools,...drawingAgentTools,{name:'aether_review_read',description:'',inputSchema:{}},{name:'aether_review_mutate',description:'',inputSchema:{}}];
 const result=cadReadOnlyInteraction({contextKey:'test',tools,execute:async()=>({})});
 expect(result.readOnlyTools).toEqual(expect.arrayContaining(['aether_cad_inspect','aether_cad_assembly_inspect','aether_cad_drawing_inspect','aether_review_read']));
 for(const name of ['aether_cad_extrude','aether_cad_assembly_compose','aether_cad_drawing_edit','aether_review_mutate'])expect(result.readOnlyTools).not.toContain(name);
});
