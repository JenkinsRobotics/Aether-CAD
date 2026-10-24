import type {ConnectorCandidate, FaceTopologyData} from '../domain';
import type {PlanarFaceAnchor} from '@aether/core/document';
import {connectorAxes} from '@aether/core/geometry';

/** Connector markers are deduplicated for display. A circle center can replace
 * the marker at a planar face's centroid, but the measured face still exists. */
export function planarFaceCenter(face:FaceTopologyData):ConnectorCandidate|undefined {
 if(face.surfaceType!=='PLANE')return undefined;
 const existing=face.candidates.find(c=>c.kind==='face-center');
 if(existing)return existing;
 const origin=face.measurements?.centerMillimeters,normal=face.measurements?.planarNormal;
 if(!origin||!normal)return undefined;
 return {id:`face-${face.id}-center`,faceId:face.id,kind:'face-center',label:'Planar face center',origin:[...origin],...connectorAxes(normal,[1,0,0])};
}

const dot=(a:readonly number[],b:readonly number[])=>a.reduce((sum,v,i)=>sum+v*b[i],0);

/** Native body coordinates; the renderer's display transform is not persisted. */
export function planarFaceCandidates(topology:readonly FaceTopologyData[],normal:readonly number[],anchor?:PlanarFaceAnchor):ConnectorCandidate[] {
 return topology.flatMap(face=>{
  const candidate=planarFaceCenter(face);
  if(!candidate||dot(candidate.zAxis,normal)<=1-1e-7)return [];
  if(!anchor)return [candidate];
  const area=face.measurements?.areaSquareMillimeters;
  return area!==undefined && Math.abs(area-anchor.areaSquareMillimeters)<=Math.max(1e-6,anchor.areaSquareMillimeters*1e-9)
   && Math.hypot(...candidate.origin.map((v,i)=>v-anchor.centerMillimeters[i]))<=1e-6 ? [candidate] : [];
 });
}

/** Unique directions retain their existing parametric following behavior. */
export function anchorForPlanarFace(topology:readonly FaceTopologyData[],faceId:number):PlanarFaceAnchor|null|undefined {
 const face=topology.find(f=>f.id===faceId),center=face&&planarFaceCenter(face);
 if(face?.surfaceType!=='PLANE'||!center)return null;
 if(planarFaceCandidates(topology,center.zAxis).length===1)return undefined;
 const area=face.measurements?.areaSquareMillimeters;
 if(area===undefined||!Number.isFinite(area)||area<=0)return null;
 const anchor:PlanarFaceAnchor={centerMillimeters:[...center.origin],areaSquareMillimeters:area};
 return planarFaceCandidates(topology,center.zAxis,anchor).length===1?anchor:null;
}
