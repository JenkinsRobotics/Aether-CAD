import { appendSolidPrimitive, defaultPrimitiveDimensions } from './modeling/solid-primitives';

export interface AssemblyComposeRequest {
  data_base64: string;
  expected_revision: string;
  assembly_id: string;
  recipe: unknown;
}
export interface AssemblyComposeResult {
  data_base64: string;
  revision: string;
  assembly_id: string;
  ids: { parts: Record<string,string>; instances: Record<string,string>; mates: Record<string,string> };
  instance_count: number;
  evaluated_parts: {part_id:string; body_count:number; volume_mm3:number}[];
  engine: string;
}
export async function composeAssembly(request: AssemblyComposeRequest, signal?: AbortSignal): Promise<AssemblyComposeResult> {
  const response = await fetch('/api/cad/assembly-compose', { method:'POST', credentials:'same-origin',
    headers:{'Content-Type':'application/json'}, body:JSON.stringify(request), signal });
  const result = await response.json();
  if (!response.ok || result.error) throw Error(typeof result.error==='string' ? result.error :
    result.error?.message ?? 'Assembly creation was refused. Check the recipe references, Part geometry and mate constraints; no edit was applied.');
  if (typeof result.data_base64 !== 'string' || typeof result.revision !== 'string' || result.assembly_id !== request.assembly_id)
    throw Error('The assembly worker returned an incomplete result.');
  return result;
}
export type AssemblyRecipePreset = 'single'|'linear'|'circular'|'template';
export function exampleAssemblyRecipe(kind: AssemblyRecipePreset = 'single', partID?: string) {
  const document = appendSolidPrimitive(null, 'box', {...defaultPrimitiveDimensions,width:10,length:10,height:10});
  return {version:1, parts:[partID ? {key:'block',part_id:partID} : {key:'block',name:'Block',document}],
    instances:kind==='template'?[]:[{key:'Block:1',part:'block',position_mm:kind==='circular'?[30,0,0]:[0,0,0],grounded:true}],
    ...(kind==='single'||kind==='template'?{}:{patterns:[kind==='linear'
      ? {key:'Row',source:'Block:1',kind:'linear',count:4,step_mm:[20,0,0]}
      : {key:'Ring',source:'Block:1',kind:'circular',count:6,axis_xyz:[0,0,1],center_mm:[0,0,0],step_degrees:60,rotate:true}]})};
}
