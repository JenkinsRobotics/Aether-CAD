/** Agent authoring is a client of the normal CAD document and native engine. */
import { insertFeature, rollbackPosition, validatePartDocument, type PartDocument, type ProfileFeature, type PartFeature } from '@aether/core/document';
import type { AgentTool } from '@aether/ui/AgentServices';
import { prepareCommand } from './commands';
import { appendSolidPrimitive, defaultPrimitiveDimensions, primitiveFields, type SolidPrimitive } from '../modeling/solid-primitives';
import { partAITools } from '../ai/catalog';

const number={type:'number'},string={type:'string'},boolean={type:'boolean'};
const tool=(name:string,description:string,properties:Record<string,unknown>,required:string[]=[]):AgentTool=>({name:'aether_cad_'+name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}});
const plane={name:string,plane:{type:'string',enum:['XY','XZ','YZ']},offset_mm:number};
const operation={name:string,profile_id:string,operation:{type:'string',enum:['new','add','cut']},target_body_id:string};
export const cadAgentTools:AgentTool[]=[
  ...partAITools,
  tool('inspect','Inspect the open Part: feature IDs, editable parameters and body IDs. All geometry tools use explicit millimeters or degrees. Use offset/limit to page the features.',{offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:50}}),
  tool('feature_references','Inspect direct inputs or dependents of one feature before editing. Uses the canonical history graph, including suppressed features; does not claim face/edge correspondence or geometric validity. Paginate using next_offset.',{feature_id:string,direction:{type:'string',enum:['inputs','dependents']},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:50}},['feature_id']),
  tool('solid_primitive','Create a new exact body with editable profile and solid features, using the same operation as the tool tray. Choose box (width_mm, length_mm, height_mm), cylinder or cone (radius_mm, height_mm), sphere (radius_mm), or torus (radius_mm, tube_radius_mm). All listed dimensions for the chosen kind are required; other dimensions are refused. Cone base lies on XY and its tip points in positive Z. Rebuild must succeed before committing.',{kind:{type:'string',enum:Object.keys(primitiveFields)},width_mm:number,length_mm:number,height_mm:number,radius_mm:number,tube_radius_mm:number},['kind']),
  tool('sketch_rectangle','Add an editable rectangular sketch profile on XY, XZ or YZ. x_mm/y_mm are local sketch coordinates; offset_mm moves its plane along its normal.',{...plane,x_mm:number,y_mm:number,width_mm:number,height_mm:number},['plane','x_mm','y_mm','width_mm','height_mm']),
  tool('sketch_circle','Add an editable circular sketch profile; returns its feature ID.',{...plane,center_x_mm:number,center_y_mm:number,radius_mm:number},['plane','center_x_mm','center_y_mm','radius_mm']),
  tool('sketch_polygon','Add a closed polygon sketch. Coordinates are local millimeters; do not repeat the first point. Native CAD validates the profile.',{...plane,points_mm:{type:'array',minItems:3,maxItems:128,items:{type:'array',items:number,minItems:2,maxItems:2}}},['plane','points_mm']),
  tool('extrude','Extrude a sketch: new/add travel along its normal; cut travels opposite the normal by default. Reversed flips that direction. Use new for a new body; add/cut require a target_body_id from inspect. Exact native rebuild must succeed before the document changes.',{...operation,depth_mm:number,reversed:boolean},['profile_id','depth_mm','operation']),
  tool('revolve','Revolve a sketch around a principal axis. add/cut require target_body_id. Native engine checks validity.',{...operation,axis:{type:'string',enum:['X','Y','Z']},angle_deg:number},['profile_id','axis','angle_deg','operation']),
  tool('extrude_depth','Change an existing blind/symmetric extrusion depth, then rebuild.',{feature_id:string,depth_mm:number},['feature_id','depth_mm']),
  tool('suppress','Suppress or unsuppress an existing feature. Rebuild must succeed.',{feature_id:string,suppressed:boolean},['feature_id','suppressed']),
  tool('undo','Undo one successful Part edit, using the same history as the editor.',{}),
  tool('redo','Redo one Part edit, using the same history as the editor.',{}),
];
type Args=Record<string,unknown>;
function numberValue(a:Args,key:string,fallback?:number,positive=false):number {
  const v=a[key]??fallback;
  if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e6||(positive&&v<=0))throw Error(`${key} must be finite ${positive?'and positive ':''}within 1000000.`);
  return v;
}
function nameValue(a:Args,fallback:string):string {
  const v=a.name??fallback;
  if(typeof v!=='string'||!v.trim()||v.length>200)throw Error('Use a name with 1–200 characters.');
  return v;
}
export function validateLiveArguments(name:string,args:Args) {
  const t=cadAgentTools.find(t=>t.name===name);
  if(!t||!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(t.inputSchema.properties as object,k)))throw Error('Unknown CAD tool or argument.');
}
export function inspectPart(doc:PartDocument,args:Args={}) {
  const offset=numberValue(args,'offset',0),limit=numberValue(args,'limit',25,true);
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit>50)throw Error('Use offset >= 0 and limit 1–50.');
  const result=prepareCommand('cad.part.inspect',JSON.stringify(doc),{}).result;
  return {...result,total_features:doc.features.length,offset,features:result.features.slice(offset,offset+limit).map((f,i)=>{
    const source=doc.features[offset+i];
    return {...f,...(source.type==='profile'?{plane:source.plane,offset_mm:source.offsetMillimeters,profile:source.profile.type==='circle'||source.profile.type==='polygon'?source.profile:{type:source.profile.type}}:{})};
  }),next_offset:offset+limit<doc.features.length?offset+limit:null};
}
export function preparePartEdit(doc:PartDocument,name:string,args:Args):{document:PartDocument;featureID:string} {
  validateLiveArguments(name,args);validatePartDocument(doc);
  if(rollbackPosition(doc)!==doc.features.length)throw Error('Move the rollback bar to the end before agent editing.');
  if(doc.features.length>=512)throw Error('Agent editing supports at most 512 features.');
  if(name==='aether_cad_solid_primitive') {
    if(typeof args.kind!=='string'||!Object.hasOwn(primitiveFields,args.kind))throw Error('Choose box, cylinder, cone, sphere or torus.');
    if(doc.features.length>510)throw Error('A primitive requires room for two features within the 512-feature limit.');
    const kind=args.kind as SolidPrimitive;
    const names={width:'width_mm',length:'length_mm',height:'height_mm',radius:'radius_mm',tubeRadius:'tube_radius_mm'} as const;
    const required=primitiveFields[kind];
    const allowed=new Set<string>(['kind',...required.map(key=>names[key])]);
    if(Object.keys(args).some(key=>!allowed.has(key)))throw Error('Only provide the dimensions used by the chosen primitive.');
    const dimensions={...defaultPrimitiveDimensions};
    for(const key of required)dimensions[key]=numberValue(args,names[key],undefined,true);
    const document=appendSolidPrimitive(doc,kind,dimensions);
    return {document,featureID:document.features.at(-1)!.id};
  }
  if(name==='aether_cad_extrude_depth'||name==='aether_cad_suppress') {
    if(typeof args.feature_id!=='string')throw Error('Inspect the part for its feature ID.');
    if(name==='aether_cad_suppress'&&typeof args.suppressed!=='boolean')throw Error('suppressed must be true or false.');
    const result=prepareCommand(name==='aether_cad_suppress'?'cad.feature.suppress':'cad.extrude.setdepth',JSON.stringify(doc),{feature_id:args.feature_id,...(name==='aether_cad_suppress'?{action:args.suppressed?'suppress' as const:'unsuppress' as const}:{depth_mm:numberValue(args,'depth_mm',undefined,true)})});
    if(!result.candidate)throw Error('The CAD operation produced no candidate.');
    return {document:JSON.parse(result.candidate) as PartDocument,featureID:args.feature_id};
  }
  const id=crypto.randomUUID();let feature:PartFeature;
  if(name.startsWith('aether_cad_sketch_')) {
    if(!['XY','XZ','YZ'].includes(String(args.plane)))throw Error('Choose XY, XZ or YZ.');
    let profile:ProfileFeature['profile'];
    if(name==='aether_cad_sketch_circle')profile={type:'circle',centerMillimeters:[numberValue(args,'center_x_mm'),numberValue(args,'center_y_mm')],radiusMillimeters:numberValue(args,'radius_mm',undefined,true)};
    else if(name==='aether_cad_sketch_rectangle'){
      const x=numberValue(args,'x_mm'),y=numberValue(args,'y_mm'),w=numberValue(args,'width_mm',undefined,true),h=numberValue(args,'height_mm',undefined,true);
      profile={type:'polygon',pointsMillimeters:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]};
    }else{
      if(!Array.isArray(args.points_mm)||args.points_mm.length<3||args.points_mm.length>128)throw Error('Use 3–128 points.');
      profile={type:'polygon',pointsMillimeters:args.points_mm.map(p=>{if(!Array.isArray(p)||p.length!==2)throw Error('Use x,y pairs.');return [numberValue({v:p[0]},'v'),numberValue({v:p[1]},'v')];})};
    }
    feature={type:'profile',id,name:nameValue(args,`Sketch ${doc.features.length+1}`),suppressed:false,plane:args.plane as ProfileFeature['plane'],offsetMillimeters:numberValue(args,'offset_mm',0),profile};
  }else if(name==='aether_cad_extrude'||name==='aether_cad_revolve'){
    const profile=doc.features.find(f=>f.id===args.profile_id&&(f.type==='profile'||f.type==='sketch')&&!f.suppressed);
    if(!profile)throw Error('Inspect the part and choose an unsuppressed sketch ID.');
    if(!['new','add','cut'].includes(String(args.operation)))throw Error('Choose new, add or cut.');
    const operation=args.operation as 'new'|'add'|'cut';
    if(operation!=='new'&&typeof args.target_body_id!=='string')throw Error('Choose a target_body_id from inspect.');
    const common={id,suppressed:false,profileFeatureId:profile.id,operation,...(operation!=='new'?{targetBodyId:args.target_body_id as string}:{})};
    if(name==='aether_cad_extrude'){
      if(args.reversed!==undefined&&typeof args.reversed!=='boolean')throw Error('reversed must be true or false.');
      feature={...common,type:'extrude',name:nameValue(args,'Extrude'),distanceMillimeters:numberValue(args,'depth_mm',undefined,true),endType:'blind',...(args.reversed?{reversed:true}:{}),...(operation==='new'?{separateBodies:true}:{})};
    }else{
      if(!['X','Y','Z'].includes(String(args.axis)))throw Error('Choose X, Y or Z.');
      const angle=numberValue(args,'angle_deg',undefined,true);if(angle>360)throw Error('Revolve angle must be at most 360 degrees.');
      feature={...common,type:'revolve',name:nameValue(args,'Revolve'),axis:args.axis as 'X'|'Y'|'Z',angleDegrees:angle};
    }
  }else throw Error('Unknown CAD edit.');
  return {document:insertFeature(doc,feature),featureID:id};
}
