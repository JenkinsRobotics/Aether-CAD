import type { AgentTool } from '@aether/ui/AgentServices';
import { plateProgram } from './program';

/** Documentation projects the executable tool catalog, never a second API list. */
export function discoverCAD(tools:readonly AgentTool[],args:Record<string,unknown>,workspace:'part'|'assembly') {
  if(Object.keys(args).some(key=>!['query','name','offset'].includes(key)) ||
      (args.query!==undefined&&(typeof args.query!=='string'||args.query.length>200)) ||
      (args.name!==undefined&&(typeof args.name!=='string'||args.name.length>100)))throw Error('Use a query of at most 200 characters or an exact tool name.');
  const offset=args.offset??0;
  if(typeof offset!=='number'||!Number.isInteger(offset)||offset<0||offset>1000)throw Error('Use an integer offset from 0 to 1000.');
  const words=String(args.query??'').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const entries=tools.filter(tool=>!args.name||tool.name===args.name).map(tool=>{
    const text=`${tool.name} ${tool.description}`.toLowerCase();
    return {tool,score:words.reduce((score,word)=>score+(text.includes(word)?1:0),0)};
  }).filter(item=>!words.length||item.score>0).sort((a,b)=>b.score-a.score||a.tool.name.localeCompare(b.tool.name));
  return {module:'AetherCAD.AI',workspace,runtime:'open-editor',changed:false,
    total:entries.length,tools:entries.slice(offset,offset+5).map(item=>item.tool),next_offset:offset+5<entries.length?offset+5:null,
    workflow:['Discover supported operations and inspect current identities.','Execute validated edits; use a Part program or Assembly recipe for one transaction.','Check exact geometry and inspect the viewport when those tools are available.','Save through the normal document workflow.'],
    ...(workspace==='part'?{example:{name:'80 × 50 × 10 mm plate',tool:'aether_cad_run_program',arguments:{program_json:JSON.stringify(plateProgram)},expected_volume_mm3:40000,verify_with:'aether_cad_verify'}}:{}),
    limits:['Only listed tools execute in this workspace.','Full ClassCAD feature coverage and external MCP/CLI parity are not complete.','Proof applies to the inspected state; recheck after an edit.']};
}
