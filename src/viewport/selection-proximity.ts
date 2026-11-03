import * as THREE from 'three/webgpu';
import type {ConnectorCandidate} from '../aether-core';
import type {CADScreenPoint} from '../cad-selection-store';
import type {ScreenProjector} from './box-selection';

/** Prefer a nearby exact edge/vertex; never pick the far edge of a large face. */
export function selectionCandidateDistance(candidate:ConnectorCandidate,matrix:THREE.Matrix4,point:CADScreenPoint,project:ScreenProjector):number {
  const m=candidate.measurements,origin=new THREE.Vector3(...candidate.origin);
  if(candidate.kind==='edge-midpoint'&&m?.linearDirection&&m.lengthMillimeters) {
    const half=new THREE.Vector3(...m.linearDirection).multiplyScalar(m.lengthMillimeters/2);
    const a=project(origin.clone().sub(half).applyMatrix4(matrix)),b=project(origin.clone().add(half).applyMatrix4(matrix));
    if(!a||!b)return Infinity;
    const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
    const t=length?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/length)):0;
    return Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy);
  }
  if(candidate.kind==='edge-midpoint'&&candidate.polylineMillimeters&&candidate.polylineMillimeters.length>=6) {
    // The engine's sampled polyline: the pointer's distance to the edge itself, for any curve.
    const line=candidate.polylineMillimeters;let best=Infinity,previous:{x:number;y:number}|null=null;
    for(let i=0;i+2<line.length;i+=3){
      const q=project(new THREE.Vector3(line[i],line[i+1],line[i+2]).applyMatrix4(matrix));
      if(!q)return Infinity;
      if(previous){const dx=q.x-previous.x,dy=q.y-previous.y,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((point.x-previous.x)*dx+(point.y-previous.y)*dy)/length)):0;best=Math.min(best,Math.hypot(point.x-previous.x-t*dx,point.y-previous.y-t*dy));}
      previous=q;
    }
    return best;
  }
  if(candidate.kind==='edge-midpoint'&&m?.centerMillimeters&&m.axisDirection&&m.radiusMillimeters&&m.lengthMillimeters) {
    // A circular arc: the pointer's distance to the arc itself (sampled), not to its midpoint,
    // so a revolved rim picks anywhere along it (Jonathan, 2026-11-02).
    const center=new THREE.Vector3(...m.centerMillimeters),axis=new THREE.Vector3(...m.axisDirection).normalize();
    const u=origin.clone().sub(center).normalize(),v=new THREE.Vector3().crossVectors(axis,u),half=Math.min(Math.PI,m.lengthMillimeters/(2*m.radiusMillimeters));
    const steps=Math.max(4,Math.ceil(half*2/(Math.PI/24)));
    let best=Infinity,previous:{x:number;y:number}|null=null;
    for(let i=0;i<=steps;i++){
      const angle=-half+half*2*i/steps;
      const q=project(center.clone().addScaledVector(u,m.radiusMillimeters*Math.cos(angle)).addScaledVector(v,m.radiusMillimeters*Math.sin(angle)).applyMatrix4(matrix));
      if(!q)return Infinity;
      if(previous){const dx=q.x-previous.x,dy=q.y-previous.y,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((point.x-previous.x)*dx+(point.y-previous.y)*dy)/length)):0;best=Math.min(best,Math.hypot(point.x-previous.x-t*dx,point.y-previous.y-t*dy));}
      previous=q;
    }
    return best;
  }
  const p=project(origin.applyMatrix4(matrix));
  return p?Math.hypot(p.x-point.x,p.y-point.y):Infinity;
}
