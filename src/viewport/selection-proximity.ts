import * as THREE from 'three/webgpu';
import type {ConnectorCandidate} from '../aether-core';
import type {CADScreenPoint} from '../cad-selection-store';
import type {ScreenProjector} from './box-selection';

/** The pointer's screen distance to an exact edge or vertex: to the edge itself (a line,
 *  the engine's sampled polyline, or a circular arc), never only to its midpoint, so a
 *  rim picks anywhere along it. Samples that do not project (behind the camera's near
 *  plane when zoomed in close) are skipped, not fatal: the visible part of a large edge
 *  stays pickable (Jonathan, 2026-11-03). */
export function selectionCandidateDistance(candidate:ConnectorCandidate,matrix:THREE.Matrix4,point:CADScreenPoint,project:ScreenProjector):number {
  const origin=new THREE.Vector3(...candidate.origin);
  if(candidate.kind==='edge-midpoint'){
    const samples=edgeSamples(candidate,origin);
    if(samples) return polylineDistance(samples.map(p=>project(p.applyMatrix4(matrix))),point);
  }
  const p=project(origin.applyMatrix4(matrix));
  return p?Math.hypot(p.x-point.x,p.y-point.y):Infinity;
}

/** World-space samples along the edge, or null when the candidate carries no curve. */
function edgeSamples(candidate:ConnectorCandidate,origin:THREE.Vector3):THREE.Vector3[]|null {
  const m=candidate.measurements;
  if(candidate.polylineMillimeters&&candidate.polylineMillimeters.length>=6){
    const line=candidate.polylineMillimeters,points:THREE.Vector3[]=[];
    for(let i=0;i+2<line.length;i+=3)points.push(new THREE.Vector3(line[i],line[i+1],line[i+2]));
    return points;
  }
  if(m?.linearDirection&&m.lengthMillimeters){
    // A straight edge is sampled too, so an endpoint behind the camera only loses its own end.
    const half=new THREE.Vector3(...m.linearDirection).multiplyScalar(m.lengthMillimeters/2),a=origin.clone().sub(half),b=origin.clone().add(half);
    return Array.from({length:17},(_,i)=>a.clone().lerp(b,i/16));
  }
  if(m?.centerMillimeters&&m.axisDirection&&m.radiusMillimeters&&m.lengthMillimeters){
    const center=new THREE.Vector3(...m.centerMillimeters),axis=new THREE.Vector3(...m.axisDirection).normalize();
    const u=origin.clone().sub(center).normalize(),v=new THREE.Vector3().crossVectors(axis,u),half=Math.min(Math.PI,m.lengthMillimeters/(2*m.radiusMillimeters));
    const steps=Math.max(4,Math.ceil(half*2/(Math.PI/24)));
    return Array.from({length:steps+1},(_,i)=>{const angle=-half+half*2*i/steps;return center.clone().addScaledVector(u,m.radiusMillimeters!*Math.cos(angle)).addScaledVector(v,m.radiusMillimeters!*Math.sin(angle));});
  }
  return null;
}

/** Distance from the point to the projected polyline; a segment with an unprojectable end is skipped. */
function polylineDistance(projected:readonly ({x:number;y:number}|null)[],point:CADScreenPoint):number {
  let best=Infinity,previous:{x:number;y:number}|null=null;
  for(const q of projected){
    if(!q){previous=null;continue;}
    if(previous){
      const dx=q.x-previous.x,dy=q.y-previous.y,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((point.x-previous.x)*dx+(point.y-previous.y)*dy)/length)):0;
      best=Math.min(best,Math.hypot(point.x-previous.x-t*dx,point.y-previous.y-t*dy));
    }
    previous=q;
  }
  return best;
}
