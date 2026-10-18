import type { AgentTool } from '@aether/ui/AgentServices';

const tool = (name:string, description:string, properties:Record<string,unknown>, required:string[]=[]):AgentTool => ({
  name:`aether_cad_${name}`, description,
  inputSchema:{type:'object', properties, required, additionalProperties:false},
});

export const knowledgeTool = tool('docs',
  'Discover the actual tools and examples available in this CAD editor. Search by query or describe one exact tool name. Results include input schemas and honest runtime limits; discovering a tool does not execute it.',
  {query:{type:'string',maxLength:200},name:{type:'string',maxLength:100},offset:{type:'integer',minimum:0}});

export const partAITools:AgentTool[] = [knowledgeTool,
  tool('run_program',
    'Run 1–16 existing Part editing commands as one transaction and one undo step. program_json is {version:1,steps:[{id,tool,arguments}]}. Tool names are existing aether_cad_* editing tools. Later arguments may use {"$ref":"step_id.feature_id"} or {"$ref":"step_id.body_id"}. Exact rebuilds resolve identities between steps; only the completed program commits. No arbitrary JavaScript, loops, filesystem or network access. Use docs for examples, then verify and preview the result.',
    {program_json:{type:'string',maxLength:65536}},['program_json']),
  tool('verify',
    'Rebuild and inspect exact native solid properties without editing. Returns volume in mm³, area in mm², center and bounds in mm; optional density in kg/m³ adds mass and inertia. Meshes and invalid geometry are refused. This is geometry evidence, not engineering certification.',
    {density_kg_m3:{type:'number',exclusiveMinimum:0,maximum:1000000},offset:{type:'integer',minimum:0,maximum:512}}),
  tool('preview',
    'Inspect a PNG of the current CAD viewport without changing camera, selection or history. Includes visible bodies, current display settings and overlays; hidden/off-screen geometry is not shown. A visual check complements exact verify measurements. No app panels or desktop capture.',{}),
];
