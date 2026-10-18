import {Plane,Raycaster,Vector2,Vector3,type Camera} from 'three/webgpu';
import type {NumericPartTransform} from '@aether/core/document';
import type {TransformPreviewFrame} from '@aether/core/contracts';
import {extrusionAxisDepth} from './extrusion-axis';

export type TransformHandleKey='distance'|'moveX'|'moveY'|'moveZ'|'angle'|'scaleX'|'scaleY'|'scaleZ';
type Point={x:number;y:number};
export interface TransformHandleProjection extends Point {
 key:TransformHandleKey;label:string;color:string;points:Point[];
 /** Millimeters, degrees or factor, matching the canonical field. */
 valueAt:(x:number,y:number)=>number|null;
 cyclic?:number;
}
export type TransformGizmoRequest={frame:TransformPreviewFrame;transform:NumericPartTransform;uniform:boolean;translationAxis?:[number,number,number]};
type Rect={left:number;top:number;width:number;height:number};
const axes=[new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)];
const letters=['X','Y','Z'],colors=['#c94b58','#288357','#387acb'];

/** Camera-only interaction math; native preview owns the solid and anchor. */
export function projectTransformGizmo(camera:Camera,rect:Rect,request:TransformGizmoRequest):TransformHandleProjection[] {
 if(rect.width<=0||rect.height<=0)return [];
 const {frame,transform:t}=request;
 if(![...frame.centerMillimeters,frame.radiusMillimeters].every(Number.isFinite)||frame.radiusMillimeters<=0||t.kind==='copy')return [];
 // A drag keeps this camera/rectangle even if a new preview is rendered.
 const frozen=camera.clone();frozen.updateMatrixWorld(true);
 const screen=(point:Vector3):Point|null=>{const p=point.clone().project(frozen);return [p.x,p.y,p.z].every(Number.isFinite)&&p.z>=-1&&p.z<=1?{x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2}:null;};
 const rayAt=(x:number,y:number)=>{const ray=new Raycaster();ray.setFromCamera(new Vector2((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1),frozen);return ray.ray;};
 const origin=new Vector3(...(t.kind==='translate'?frame.centerMillimeters:t.kind==='rotate'?t.axisOriginMillimeters:t.centerMillimeters));
 if(t.kind==='translate')origin.add(new Vector3(...t.translationMillimeters));
 const start=screen(origin);if(!start)return [];
 const lengths=axes.map(axis=>{const p=screen(origin.clone().add(axis));return p?Math.hypot(p.x-start.x,p.y-start.y):0;});
 const pixelsPerMM=Math.max(...lengths);if(!Number.isFinite(pixelsPerMM)||pixelsPerMM<1e-9)return [];
 const lever=78/pixelsPerMM;
 if(t.kind==='rotate'){
  const axis=new Vector3(...t.axisDirection);if(Math.abs(axis.length()-1)>1e-6||!Number.isFinite(t.angleDegrees))return [];
  const seed=axes.reduce((a,b)=>Math.abs(a.dot(axis))<=Math.abs(b.dot(axis))?a:b);
  const u=seed.clone().addScaledVector(axis,-seed.dot(axis)).normalize(),v=new Vector3().crossVectors(axis,u);
  const point=(degrees:number)=>origin.clone().addScaledVector(u,lever*Math.cos(degrees*Math.PI/180)).addScaledVector(v,lever*Math.sin(degrees*Math.PI/180));
  const end=screen(point(t.angleDegrees));if(!end)return [];
  const plane=new Plane(axis,-axis.dot(origin));
  const valueAt=(x:number,y:number)=>{
   const ray=rayAt(x,y);if(Math.abs(ray.direction.dot(axis))<.05)return null;
   const hit=ray.intersectPlane(plane,new Vector3());if(!hit)return null;
   const d=hit.sub(origin);if(d.length()<lever*.02)return null;
   return Math.atan2(d.dot(v),d.dot(u))*180/Math.PI;
  };
  if(valueAt(end.x,end.y)===null)return [];
  const points=Array.from({length:65},(_,i)=>screen(point(i*360/64)));if(points.some(p=>!p))return [];
  return [{key:'angle',label:'Rotate parts',color:'#387acb',...end,points:points as Point[],cyclic:360,valueAt}];
 }
 if(t.kind==='translate'&&request.translationAxis){
  const axis=new Vector3(...request.translationAxis);if(Math.abs(axis.length()-1)>1e-6)return [];
  const end=screen(origin.clone().addScaledVector(axis,lever));if(!end)return [];
  const valueAt=(x:number,y:number)=>extrusionAxisDepth(rayAt(x,y),origin,axis);
  return valueAt(end.x,end.y)===null?[]:[{key:'distance',label:'Move along reference',color:'#387acb',...end,points:[start,end],valueAt}];
 }
 const indexes=t.kind==='scale'&&request.uniform?[lengths.indexOf(pixelsPerMM)]:[0,1,2];
 return indexes.flatMap(index=>{
  const axis=axes[index],scale=t.kind==='scale';
  const factor=scale?t.scaleFactors[index]:1;if(!Number.isFinite(factor)||factor<=0)return [];
  const point=origin.clone().addScaledVector(axis,lever*factor),end=screen(point);if(!end)return [];
  const valueAt=(x:number,y:number)=>{const d=extrusionAxisDepth(rayAt(x,y),origin,axis);return d===null?null:scale?d/lever:d;};
  if(valueAt(end.x,end.y)===null)return [];
  return [{key:(scale?`scale${request.uniform?'X':letters[index]}`:`move${letters[index]}`) as TransformHandleKey,
   label:scale?(request.uniform?'Scale uniformly':`Scale along ${letters[index]}`):`Move along ${letters[index]}`,
   color:scale&&request.uniform?'#546578':colors[index],...end,points:[start,end],valueAt}];
 });
}
