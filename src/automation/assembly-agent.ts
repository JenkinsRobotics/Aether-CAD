import type { AgentInteraction, AgentTool } from '@aether/ui/AgentServices';
import type { CADAssemblyController } from '../cad-assembly-controller';
import { exampleAssemblyRecipe } from '../assembly-recipe';
import { knowledgeTool } from '../ai/catalog';
import { discoverCAD } from '../ai/knowledge';

const tool=(name:string,description:string,properties:Record<string,unknown>={},required:string[]=[]):AgentTool=>({
  name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}});
export const assemblyAgentTools:AgentTool[]=[
  knowledgeTool,
  tool('aether_cad_assembly_inspect','Inspect reusable Part definitions, instances, mates and insertion history. Returns a JSON recipe example with explicit millimeter units.'),
  tool('aether_cad_assembly_compose','Append an assembly recipe as one edit after exact Part rebuilding and native solving. JSON version 1: parts [{key,part_id} or {key,name,document}], instances [{key,part,position_mm?,rotation_xyzw?,grounded?}], mates [{key,kind:fastened|revolute|prismatic,a:{instance,origin_mm?,z_axis?,x_axis?},b:{...}}], patterns [{key,source,kind:linear,count,step_mm} or {key,source,kind:circular,count,axis_xyz,center_mm,step_degrees,rotate?}]. Count includes the seed. At least one instance must be grounded. Arrays are individual instances, not associative patterns. No nested assemblies.',{recipe_json:{type:'string'}},['recipe_json']),
  tool('aether_cad_assembly_undo','Undo the latest recipe insertion, only while no intervening assembly edit occurred.'),
  tool('aether_cad_assembly_redo','Redo the last undone recipe insertion, only while no intervening assembly edit occurred.'),
];
export function assemblyAgentInteraction(controller:CADAssemblyController, contextKey:string, currentKey:()=>string, writable:()=>boolean):AgentInteraction {
  return {contextKey,tools:assemblyAgentTools,execute:async(call,signal)=>{
    signal.throwIfAborted();
    if(currentKey()!==contextKey)throw Error('The active Assembly changed.');
    const descriptor=assemblyAgentTools.find(tool=>tool.name===call.name);
    if(!descriptor||!call.arguments||Object.keys(call.arguments).some(key=>!Object.hasOwn(descriptor.inputSchema.properties as object,key)))throw Error('Unknown Assembly tool or argument.');
    if(call.name==='aether_cad_docs')return discoverCAD(assemblyAgentTools,call.arguments,'assembly');
    const projection=controller.geometryProjection;
    if(!projection)throw Error('Open an Assembly first.');
    if(call.name==='aether_cad_assembly_inspect')return {
      assembly_id:projection.assembly_id,revision:projection.revision,
      parts:projection.part_definitions.map(p=>({id:p.id,name:p.name,has_geometry:!!p.feature_document})),
      instances:projection.instances.map(i=>({id:i.id,name:i.name,part_id:i.definition_id,grounded:i.grounded})),
      mates:projection.mates.map(m=>({id:m.id,name:m.name,kind:m.type_id})),
      can_undo:controller.canUndoRecipe,can_redo:controller.canRedoRecipe,
      example:exampleAssemblyRecipe('linear',projection.part_definitions.find(p=>p.feature_document)?.id),
    };
    if(!writable())throw Error('This Assembly is read-only or another editor is active.');
    if(call.name==='aether_cad_assembly_compose'){
      if(typeof call.arguments.recipe_json!=='string'||call.arguments.recipe_json.length>2*1024*1024)throw Error('Provide a JSON recipe of at most 2 MiB.');
      return {changed:true,...await controller.composeRecipe(JSON.parse(call.arguments.recipe_json),signal)};
    }
    await controller.undoRecipe(call.name==='aether_cad_assembly_undo'?-1:1,signal);
    return {changed:true,revision:controller.geometryProjection?.revision};
  }};
}
