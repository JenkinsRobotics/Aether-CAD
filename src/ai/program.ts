import { availableBodies, type PartDocument } from '@aether/core/document';
import { preparePartEdit } from '../automation/live-commands';

export const programToolNames = ['solid_primitive','sketch_rectangle','sketch_circle','sketch_polygon','extrude','revolve','extrude_depth','suppress'].map(name=>`aether_cad_${name}`);
const edits = new Set(programToolNames);
export type Reference = {feature_id:string;body_id?:string};
export type ProgramStep = {id:string;tool:string;arguments:Record<string,unknown>};
const object = (value:unknown):value is Record<string,unknown> => !!value && typeof value==='object' && !Array.isArray(value);
function fields(value:unknown, names:string[]):asserts value is Record<string,unknown> {
  if(!object(value)||Object.keys(value).some(key=>!names.includes(key)))throw Error('Unknown or malformed program fields.');
}

/** Input-only orchestration. Every step calls the ordinary product operation;
 * the live adapter owns exact evaluation, stale checks, commit and undo. */
export function parseProgram(encoded:unknown):ProgramStep[] {
  if(typeof encoded!=='string'||new TextEncoder().encode(encoded).length>65536)throw Error('Use a program of at most 64 KiB.');
  const program:unknown=JSON.parse(encoded);fields(program,['version','steps']);
  if(program.version!==1||!Array.isArray(program.steps)||!program.steps.length||program.steps.length>16)throw Error('Use version 1 with 1–16 steps.');
  const ids=new Set<string>();
  for(const step of program.steps){
    fields(step,['id','tool','arguments']);
    if(typeof step.id!=='string'||!/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(step.id)||ids.has(step.id))throw Error('Use unique step IDs of 1–40 letters, digits, underscores or hyphens, starting with a letter.');
    if(typeof step.tool!=='string'||!edits.has(step.tool)||!object(step.arguments))throw Error('Choose an existing Part editing tool with an arguments object.');
    ids.add(step.id);
  }
  return program.steps as ProgramStep[];
}

export function prepareProgramStep(source:PartDocument, step:ProgramStep, references:Record<string,Reference>) {
  parseProgram(JSON.stringify({version:1,steps:[step]}));
  if(Object.hasOwn(references,step.id))throw Error('A program step cannot execute twice.');
  function resolve(value:unknown,depth=0):unknown {
    if(depth>12)throw Error('Program arguments are nested too deeply.');
    if(Array.isArray(value))return value.map(item=>resolve(item,depth+1));
    if(!object(value))return value;
    if('$ref' in value){
      fields(value,['$ref']);
      const match=typeof value.$ref==='string'&&/^([a-zA-Z][a-zA-Z0-9_-]{0,39})\.(feature_id|body_id)$/.exec(value.$ref);
      const result=match&&Object.hasOwn(references,match[1])&&references[match[1]]?.[match[2] as keyof Reference];
      if(!result)throw Error('A program reference must name an earlier step and an available feature_id or body_id.');
      return result;
    }
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,resolve(item,depth+1)]));
  }
  const args=resolve(step.arguments) as Record<string,unknown>;
  const beforeBodyIDs=availableBodies(source).map(body=>body.id);
  const edited=preparePartEdit(structuredClone(source),step.tool,args);
  return {...edited,beforeBodyIDs,targetBodyID:typeof args.target_body_id==='string'?args.target_body_id:undefined};
}

export function programStepReference(step:Pick<ReturnType<typeof prepareProgramStep>,'featureID'|'beforeBodyIDs'|'targetBodyID'>,resolved:PartDocument):Reference {
  const before=new Set(step.beforeBodyIDs);
  const added=availableBodies(resolved).filter(body=>!before.has(body.id));
  return {feature_id:step.featureID,...(added.length===1?{body_id:added[0].id}:step.targetBodyID?{body_id:step.targetBodyID}:{})};
}

export async function executeProgram(source:PartDocument, encoded:unknown, qualify:(candidate:PartDocument)=>Promise<PartDocument>) {
  const steps=parseProgram(encoded);
  const references:Record<string,Reference>=Object.create(null);
  let document=structuredClone(source);
  for(const step of steps){
    const edited=prepareProgramStep(document,step,references);
    // Native rebuild resolves split-solid IDs before a later step can refer to
    // them. Never guess a body ID from a feature or from render tessellation.
    const resolved=await qualify(edited.document);
    references[step.id]=programStepReference(edited,resolved);
    document=resolved;
  }
  return {document,references};
}

export const plateProgram = {version:1,steps:[
  {id:'outline',tool:'aether_cad_sketch_rectangle',arguments:{plane:'XY',x_mm:0,y_mm:0,width_mm:80,height_mm:50}},
  {id:'plate',tool:'aether_cad_extrude',arguments:{profile_id:{$ref:'outline.feature_id'},depth_mm:10,operation:'new'}},
]};
