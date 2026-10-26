import { Matrix4, Plane, Raycaster, Vector2, Vector3, type Camera } from 'three/webgpu';
import type { NumericPartTransform } from '@aether/core/document';
import type { ManipulatorHandle } from '@aether/ui';
import { extrusionAxisDepth } from './extrusion-axis';

export type Point3 = [number, number, number];
export interface ProjectedManipulatorHandle extends ManipulatorHandle {
  axis?: Point3;
  sample(x: number, y: number): Point3 | number | null;
}
type Rect = { left: number; top: number; width: number; height: number };
const axes = [new Vector3(1,0,0), new Vector3(0,1,0), new Vector3(0,0,1)];

/** Fixed pixel proportions; product-owned world math for axis, plane and spin. */
export function projectSelectionManipulator(camera: Camera, rect: Rect, pivot: Point3): ProjectedManipulatorHandle[] {
  if(rect.width<=0 || rect.height<=0 || !pivot.every(Number.isFinite))return [];
  const frozen = camera.clone(); frozen.updateMatrixWorld();
  const origin = new Vector3(...pivot);
  const project = (world: Vector3) => {
    const p = world.clone().project(frozen);
    return ![p.x,p.y,p.z].every(Number.isFinite) || p.z < -1 || p.z > 1 ? null : { x:(p.x+1)*rect.width/2, y:(1-p.y)*rect.height/2 };
  };
  const center = project(origin); if (!center) return [];
  const ray = (x: number,y: number) => { const r = new Raycaster(); r.setFromCamera(new Vector2((x-rect.left)/rect.width*2-1,1-(y-rect.top)/rect.height*2),frozen); return r.ray; };
  const lengths = axes.map(axis => {const p=project(origin.clone().add(axis));return p?Math.hypot(p.x-center.x,p.y-center.y):0;});
  const pixels = Math.max(...lengths); if (!Number.isFinite(pixels) || pixels < 1e-9) return [];
  const reach = 65/pixels, handles: ProjectedManipulatorHandle[] = [];
  // Choose the visible ends of the axes so the controls surround the pivot,
  // rather than stacking three positive arrows on the same side of it.
  const directions=axes.map(axis=>{const p=project(origin.clone().add(axis));return new Vector2(p?p.x-center.x:0,p?p.y-center.y:0).normalize();});
  let signs=[1,1,1],best=-Infinity;
  for(const x of [-1,1])for(const y of [-1,1]){
    const trial=[x,y,1],dots=[0,1,2].map(i=>directions[i].dot(directions[(i+1)%3])*trial[i]*trial[(i+1)%3]);
    const score=-Math.max(...dots);if(score>best){best=score;signs=trial;}
  }
  const layout=axes.map((axis,i)=>axis.clone().multiplyScalar(signs[i]));
  const atRadius=(direction:Vector3,radius:number)=>{
    let length=reach;
    for(let iteration=0;iteration<3;iteration++){
      const p=project(origin.clone().addScaledVector(direction,length));if(!p)return null;
      const distance=Math.hypot(p.x-center.x,p.y-center.y);if(distance<1)return null;
      length*=radius/distance;
    }
    return origin.clone().addScaledVector(direction,length);
  };
  for (let index=0;index<3;index++) {
    const axis=axes[index], letter='XYZ'[index];
    const axisTip=atRadius(layout[index],65),tip=axisTip?project(axisTip):null;
    if (tip && Math.hypot(tip.x-center.x,tip.y-center.y)>14) handles.push({
      id:`move${letter}`,kind:'axis',label:`Move along ${letter}`, ...tip,
      angle:Math.atan2(tip.y-center.y,tip.x-center.x)*180/Math.PI+90, axis:axis.toArray(),
      sample(x,y) { const distance=extrusionAxisDepth(ray(x,y),origin,axis); return distance===null?null:axis.clone().multiplyScalar(distance).toArray(); },
    });
    const a=axes[(index+1)%3], b=axes[(index+2)%3], u=layout[(index+1)%3], v=layout[(index+2)%3];
    const plane=new Plane(axis,-axis.dot(origin));
    const hit=(x:number,y:number)=>{
      const r=ray(x,y); return Math.abs(r.direction.dot(axis))<.08 ? null : r.intersectPlane(plane,new Vector3());
    };
    const diagonal=u.clone().add(v),planeCenter=atRadius(diagonal,30);
    if(!planeCenter)continue;
    const at=project(planeCenter);
    if (!at || !hit(at.x+rect.left,at.y+rect.top)) continue;
    const polygon=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>project(planeCenter.clone().addScaledVector(u,x*reach*.09).addScaledVector(v,y*reach*.09))!);
    if(polygon.some(p=>!p))continue;
    handles.push({id:`plane${letter}`,kind:'plane',label:`Move in ${'XYZ'[(index+1)%3]}${'XYZ'[(index+2)%3]} plane`,...at,polygon,
      sample(x,y) { return hit(x,y)?.sub(origin).toArray() ?? null; }});
    const rotationPoint=atRadius(diagonal,70),rotation=rotationPoint?project(rotationPoint):null;
    if (rotation) handles.push({id:`rotate${letter}`,kind:'rotation',label:`Rotate around ${letter}`,...rotation,axis:axis.toArray(),
      angle:Math.atan2(rotation.y-center.y,rotation.x-center.x)*180/Math.PI+45,
      sample(x,y) { const p=hit(x,y)?.sub(origin); return !p || p.length()<1e-6 ? null : Math.atan2(p.dot(b),p.dot(a))*180/Math.PI; }});
  }
  handles.push({id:'pivot',kind:'pivot',label:'Move pivot · drag to snap · double-click to recenter',...center,sample:()=>null});
  return handles;
}

export function transformMatrix(transform: NumericPartTransform): Matrix4 {
  if (transform.kind==='translate') return new Matrix4().makeTranslation(...transform.translationMillimeters);
  if (transform.kind==='rotate') {
    const origin=new Vector3(...transform.axisOriginMillimeters);
    return new Matrix4().makeTranslation(...origin.toArray())
      .multiply(new Matrix4().makeRotationAxis(new Vector3(...transform.axisDirection),transform.angleDegrees*Math.PI/180))
      .multiply(new Matrix4().makeTranslation(...origin.negate().toArray()));
  }
  return new Matrix4();
}
