import {Mesh, type Group, type Raycaster} from 'three/webgpu';
import type {ImportedModelData} from '../domain';
import type {CADScreenPoint, CADSelectionItem} from '../cad-selection-store';
import {faceIdForTriangle} from './picking-math';
import type {ScreenProjector} from './box-selection';
import {selectionCandidateDistance} from './selection-proximity';

/** Repair must pick the geometry before the edited feature, never hidden final meshes. */
export function pickHistoryFace(ray:Raycaster,group:Group,model:ImportedModelData|null, topology?:{kind:'edge'|'vertex';point:CADScreenPoint;project:ScreenProjector}, allowHiddenSource=false):{item:CADSelectionItem;partName:string}|null {
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
  const kind=topology.kind;
  const distance=(candidate:typeof face.candidates[number])=>selectionCandidateDistance(candidate,hit.object.matrixWorld,topology.point,topology.project);
  const candidates=face.candidates.filter(candidate=>candidate.kind===(kind==='edge'?'edge-midpoint':'vertex'));
  const candidate=candidates.sort((a,b)=>distance(a)-distance(b))[0];
  if(!candidate||distance(candidate)>12)return null;
  return {partName:part.name,item:{id:`${kind}:${part.id}:${candidate.id}`,kind,partId:part.id,faceId:face.id,label:candidate.label,detail:`Exact ${kind}`}};
 }
 return {partName:part.name,item:{id:`face:${part.id}:${face.id}`,kind:'face',partId:part.id,faceId:face.id,
  label:`Face ${part.faceRanges.findIndex(r=>r.faceId===faceId)+1} of ${part.name}`,detail:face.surfaceType}};
}
