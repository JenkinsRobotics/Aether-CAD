import type {ConnectorCandidate, FaceTopologyData} from '../domain';
import type {PlanarFaceAnchor} from '@aether/core/document';

const dot=(a:readonly number[],b:readonly number[])=>a.reduce((sum,v,i)=>sum+v*b[i],0);

/** Native body coordinates; the renderer's display transform is not persisted. */
export function planarFaceCandidates(topology:readonly FaceTopologyData[],normal:readonly number[],anchor?:PlanarFaceAnchor):ConnectorCandidate[] {
 return topology.filter(face=>face.surfaceType==='PLANE').flatMap(face=>face.candidates.filter(candidate=>{
  if(candidate.kind!=='face-center'||dot(candidate.zAxis,normal)<=1-1e-7)return false;
  if(!anchor)return true;
  const area=face.measurements?.areaSquareMillimeters;
  return area!==undefined && Math.abs(area-anchor.areaSquareMillimeters)<=Math.max(1e-6,anchor.areaSquareMillimeters*1e-9)
   && Math.hypot(...candidate.origin.map((v,i)=>v-anchor.centerMillimeters[i]))<=1e-6;
 }));
}

/** Unique directions retain their existing parametric following behavior. */
export function anchorForPlanarFace(topology:readonly FaceTopologyData[],faceId:number):PlanarFaceAnchor|null|undefined {
 const face=topology.find(f=>f.id===faceId),center=face?.candidates.find(c=>c.kind==='face-center');
 if(face?.surfaceType!=='PLANE'||!center)return null;
 if(planarFaceCandidates(topology,center.zAxis).length===1)return undefined;
 const area=face.measurements?.areaSquareMillimeters;
 if(area===undefined||!Number.isFinite(area)||area<=0)return null;
 const anchor:PlanarFaceAnchor={centerMillimeters:[...center.origin],areaSquareMillimeters:area};
 return planarFaceCandidates(topology,center.zAxis,anchor).length===1?anchor:null;
}
