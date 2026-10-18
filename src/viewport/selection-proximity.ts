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
  const p=project(origin.applyMatrix4(matrix));
  return p?Math.hypot(p.x-point.x,p.y-point.y):Infinity;
}
