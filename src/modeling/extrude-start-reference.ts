import {principalFrame,resolvePlaneFrame,rollbackPosition,type ExtrusionStartReference,type PartDocument,type PartFeature} from '@aether/core/document';

/** Face/edge/point-captured datum definitions are not associative yet. */
function associativePlane(doc:PartDocument,id:string,before:number):Extract<PartFeature,{type:"plane"}> {
 const index=doc.features.findIndex(f=>f.id===id),plane=doc.features[index];
 if(index<0||index>=before||plane.type!=='plane'||plane.suppressed)throw Error('Starting reference plane is unavailable. Reselect an earlier plane.');
 const definition=plane.definition;
 if(definition){
  if(!['offset','mid'].includes(definition.method))throw Error('This starting plane uses captured geometry. Choose a datum derived from principal planes or select a solid face directly.');
  const refs=definition.method==='offset'?[definition.reference]:definition.method==='mid'?definition.references:[];
  for(const ref of refs){
   if(ref.kind==='face')throw Error('This starting plane uses a captured face. Select the solid face directly to follow model changes.');
   if(ref.kind==='feature')associativePlane(doc,ref.featureId,index);
  }
 }
 return plane;
}
export function nativeExtrusionStart(doc:PartDocument,ref:ExtrusionStartReference,beforeFeatureId?:string){
 if(ref.kind==='face')return ref;
 if(ref.kind==='principal')return {kind:'plane',frame:principalFrame(ref.plane)};
 const before=beforeFeatureId?doc.features.findIndex(f=>f.id===beforeFeatureId):rollbackPosition(doc);
 const plane=associativePlane(doc,ref.sourceFeatureId,before);
 return {kind:'plane',frame:resolvePlaneFrame(plane,doc.features.slice(0,doc.features.indexOf(plane)))};
}
export function extrusionStartPlanes(doc:PartDocument,beforeFeatureId?:string):ExtrusionStartReference[]{
 const refs:ExtrusionStartReference[]=(['XY','XZ','YZ'] as const).map(plane=>({kind:'principal',plane,label:plane+' plane'}));
 for(const feature of doc.features.slice(0,rollbackPosition(doc))){if(feature.id===beforeFeatureId)break;if(feature.type!=='plane')continue;
  const ref:ExtrusionStartReference={kind:'plane',sourceFeatureId:feature.id,label:feature.name};
  try{nativeExtrusionStart(doc,ref,beforeFeatureId);refs.push(ref);}catch{/* Unqualified captured datums are not offered as associative references. */}
 }
 return refs;
}
