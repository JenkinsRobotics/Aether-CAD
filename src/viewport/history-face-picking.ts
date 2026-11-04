import {Mesh, type Group, type Raycaster} from 'three/webgpu';
import type {ImportedModelData} from '@aether/core/contracts';
import type {CADScreenPoint, CADSelectionItem} from '../cad-selection-store';
import {faceIdForTriangle} from './picking-math';
import type {ScreenProjector} from './box-selection';
import {selectionCandidateDistance} from './selection-proximity';
import {resolveSelection} from './selection-rule';

/** Repair must pick the geometry before the edited feature, never hidden final meshes. */
export function pickHistoryFace(ray:Raycaster,group:Group,model:ImportedModelData|null, topology?:{kind:'auto'|'edge'|'vertex';point:CADScreenPoint;project:ScreenProjector}, allowHiddenSource=false):{item:CADSelectionItem;partName:string}|null {
 if((!group.visible&&!allowHiddenSource)||!model)return null;
 group.updateMatrixWorld(true);
 const hit=ray.intersectObjects(group.children.filter(o=>o instanceof Mesh),false)[0];
 if(!hit||hit.faceIndex===undefined||hit.faceIndex===null)return null;
 const part=model.parts.find(p=>p.id===hit.object.userData.previewPartId);
 if(!part)return null;
 const faceId=faceIdForTriangle(part.faceRanges,hit.faceIndex);
 const face=part.topology.find(f=>f.id===faceId);
 if(!face)return null;
 if(topology){
  const distance=(candidate:typeof face.candidates[number])=>selectionCandidateDistance(candidate,hit.object.matrixWorld,topology.point,topology.project);
  const target=resolveSelection(topology.kind,face.candidates,distance);
  if(!target)return null;
  if(target.kind!=='face'){
   const {kind,candidate}=target;
   return {partName:part.name,item:{id:`${kind}:${part.id}:${candidate.id}`,kind,partId:part.id,faceId:face.id,label:candidate.label,detail:`Exact ${kind}`}};
  }
 }
 return {partName:part.name,item:{id:`face:${part.id}:${face.id}`,kind:'face',partId:part.id,faceId:face.id,
  label:`Face ${part.faceRanges.findIndex(r=>r.faceId===faceId)+1}`,partLabel:part.name,detail:face.surfaceType}};
}
