import type { AgentInteraction, AgentTool } from '@aether/ui/AgentServices';
import type { AssemblyProjectionV1 } from '../cad-assembly-bridge';
import type { CADAssemblyController } from '../cad-assembly-controller';
import { exampleAssemblyRecipe } from '../assembly-recipe';
import { knowledgeTool } from '../ai/catalog';
import { discoverCAD } from '../ai/knowledge';
import { prepareAssemblyEdit } from './assembly-edit';
import { validateToolArguments } from './tool-arguments';

const tool=(name:string,description:string,properties:Record<string,unknown>={},required:string[]=[]):AgentTool=>({
  name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}});
// Native archive revisions may repeat after undo or reopening. The editor token
// identifies this immutable projection, so stale work cannot pass an ABA cycle.
const editorRevisions = new WeakMap<AssemblyProjectionV1,string>();
function editorRevision(projection: AssemblyProjectionV1): string {
  let token = editorRevisions.get(projection);
  if (!token) { token = crypto.randomUUID(); editorRevisions.set(projection,token); }
  return token;
}
const revision = { expected_revision: { type: 'string', description: 'Exact opaque editor revision from inspect or the last successful edit. source_revision is the archive counter and must not be used for this guard.' } };
export const assemblyAgentTools:AgentTool[]=[
  knowledgeTool,
  tool('aether_cad_assembly_inspect','Inspect explicit IDs, rest/solved placements, connectors, mate DOFs/limits, relations, contacts, solution and BOM. Each section has pages of 25. Stored transforms use m, angles rad; editing accepts explicit mm/deg. Summary provides a reusable-Part recipe example.',{section:{type:'string',enum:['summary','parts','instances','connectors','mates','relations','contacts','solution','bom']},offset:{type:'integer',minimum:0}}),
  tool('aether_cad_assembly_compose','Append an assembly recipe as one edit after exact Part rebuilding and native solving. JSON version 1: parts [{key,part_id} or {key,name,document}], instances [{key,part,position_mm?,rotation_xyzw?,grounded?}], mates [{key,kind:fastened|revolute|prismatic|cylindrical|ball|planar|pin_slot|parallel,a:{instance,origin_mm?,z_axis?,x_axis?},b:{...}}], patterns [{key,source,kind:linear,count,step_mm} or {key,source,kind:circular,count,axis_xyz,center_mm,step_degrees,rotate?}]. Count includes the seed. At least one instance must be grounded. Arrays are individual instances, not associative patterns. No nested assemblies.',{...revision,recipe_json:{type:'string'}},['expected_revision','recipe_json']),
  tool('aether_cad_assembly_edit','Edit existing entities by explicit IDs as one atomic, solved edit. command_json types: instance-update {id,name?,position_mm?:[x,y,z],rotation_xyzw?:unitQuaternion,visible?}; instance-grounded {id,grounded}; instance-suppressed {id,suppressed}; mate-update {id,name?,suppressed?}; dof-value {id,value,unit:deg|mm}; dof-limits {id,minimum,maximum,unit:deg|mm} (both null removes limits); connector-add {part_id,name,origin_mm?,primary_axis?,secondary_axis?} (axes positive-x/negative-x/positive-y/negative-y/positive-z/negative-z); mate-add {kind,name,a:{instance_id,connector_id},b:{instance_id,connector_id}}; relation-add or relation-update {id for update,kind:gear|rack_pinion|screw|linear,driver_dof_id,driven_dof_id,ratio,offset,unit,reversed?,suppressed?} (ratio is positive driven SI units per driver SI units; offset unit matches driven DOF); contact-add or contact-update {id for update,name,instance_ids,suppressed?}; contacts-enabled {enabled}; remove {entity:instance|mate|connector|relation|contact,id}. Inspect capabilities first. Direct DOF edits require an active free DOF; edit the relation to change a dependent value. Dependency/solve failures preserve the Assembly; deletion never implicitly removes dependents.',{...revision,command_json:{type:'string'}},['expected_revision','command_json']),
  tool('aether_cad_assembly_undo','Undo the latest Assembly edit or recipe. UI and agent edits share session history, bounded to 64 steps and 64 MiB of archive text; saved reopen clears it.',revision,['expected_revision']),
  tool('aether_cad_assembly_redo','Redo the next undone Assembly edit or recipe. A new edit after undo discards the redo branch.',revision,['expected_revision']),
];
export function inspectAssembly(controller: CADAssemblyController, args: Record<string,unknown> = {}) {
  const p = controller.geometryProjection;
  if (!p) throw Error('Open an Assembly first.');
  const section = args.section ?? 'summary', offset = args.offset ?? 0;
  if (!Number.isSafeInteger(offset) || Number(offset) < 0) throw Error('Assembly offset must be a nonnegative integer.');
  const parts = p.part_definitions.map(({feature_document,...part}) => ({...part,has_geometry:!!feature_document}));
  const sections = {parts,instances:p.instances,connectors:p.connector_definitions,mates:p.mates,relations:p.relations,contacts:p.contact_sets ?? [],bom:controller.bomProjection?.rows ?? []};
  const summary = {assembly_id:p.assembly_id,revision:editorRevision(p),source_revision:p.revision,can_undo:controller.canUndoRecipe,can_redo:controller.canRedoRecipe,
    capabilities:p.capabilities,contacts_enabled:p.contacts_enabled ?? false,
    counts:Object.fromEntries(Object.entries(sections).map(([name,items]) => [name,items.length]))};
  if (section === 'summary') return {...summary,parts:parts.slice(0,25),instances:p.instances.slice(0,25),mates:p.mates.slice(0,25),
    example:exampleAssemblyRecipe('linear',p.part_definitions.find(part => part.feature_document)?.id),
    limits:['UI and agent edits share session undo/redo, bounded to 64 steps and 64 MiB of archive text. Reopen clears history.','Nested assembly editing, cam and sweep joints are not supported.','Inspect each section to page beyond 25 entries.']};
  if (section === 'solution') {
    const solution = controller.solutionProjection;
    if (!solution) throw Error('No Assembly solution is available.');
    const page = <T,>(items: readonly T[]) => items.slice(Number(offset),Number(offset)+25);
    return {...summary,solution:{...solution,instance_world_transforms:page(solution.instance_world_transforms),dof_values:page(solution.dof_values),
      limit_violations:page(solution.limit_violations),diagnostic_ids:page(solution.diagnostic_ids)},
      next_offset:Number(offset)+25<Math.max(solution.instance_world_transforms.length,solution.dof_values.length,solution.limit_violations.length,solution.diagnostic_ids.length)?Number(offset)+25:null};
  }
  if (typeof section !== 'string' || !Object.hasOwn(sections,section)) throw Error('Unknown Assembly inspection section.');
  const items = sections[section as keyof typeof sections];
  return {...summary,section,items:items.slice(Number(offset),Number(offset)+25),total:items.length,next_offset:Number(offset)+25<items.length?Number(offset)+25:null,
    ...(section === 'bom' ? {mode:controller.bomProjection?.mode,total_mass_kg:controller.bomProjection?.total_mass_kg}: {})};
}
export function assemblyAgentInteraction(controller:CADAssemblyController, contextKey:string, currentKey:()=>string, writable:()=>boolean):AgentInteraction {
  return {contextKey,tools:assemblyAgentTools,execute:async(call,signal)=>{
    const checkContext = () => { signal.throwIfAborted(); if(currentKey()!==contextKey)throw Error('The active Assembly changed.'); };
    checkContext();
    validateToolArguments(assemblyAgentTools, call.name, call.arguments);
    if(call.name==='aether_cad_docs')return discoverCAD(assemblyAgentTools,call.arguments,'assembly');
    const projection=controller.geometryProjection;
    if(!projection)throw Error('Open an Assembly first.');
    if(call.name==='aether_cad_assembly_inspect')return {...inspectAssembly(controller,call.arguments),writable:writable()};
    const check = () => {
      checkContext(); if(!writable())throw Error('This Assembly is read-only or another editor is active.');
      if(controller.geometryProjection!==projection || typeof call.arguments.expected_revision!=='string' || call.arguments.expected_revision!==editorRevision(projection)) throw Error('The Assembly revision changed. Inspect it before editing.');
    };
    check();
    if(call.name==='aether_cad_assembly_compose'){
      if(typeof call.arguments.recipe_json!=='string'||call.arguments.recipe_json.length>2*1024*1024)throw Error('Provide a JSON recipe of at most 2 MiB.');
      const result = await controller.composeRecipe(JSON.parse(call.arguments.recipe_json),signal,check);
      return {...result,changed:true,revision:editorRevision(controller.geometryProjection!),source_revision:result.revision};
    }
    if(call.name==='aether_cad_assembly_edit') {
      if(typeof call.arguments.command_json!=='string'||call.arguments.command_json.length>256*1024)throw Error('Provide an Assembly command JSON of at most 256 KiB.');
      const edit=prepareAssemblyEdit(projection,JSON.parse(call.arguments.command_json));
      await controller.editAtomically(edit.method,edit.params,projection.revision,signal,check);
    } else await controller.undoRecipe(call.name==='aether_cad_assembly_undo'?-1:1,signal,check);
    return {changed:true,...inspectAssembly(controller)};
  }};
}
