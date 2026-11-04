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
 /** Exact projected orbit. Arrow artwork and pointer mapping use this same circle. */
 orbit?: { angle: number; pointAt: (degrees: number) => Point };
}
export type TransformGizmoRequest={frame:TransformPreviewFrame;transform:NumericPartTransform;uniform:boolean;translationAxis?:[number,number,number]};
type Rect={left:number;top:number;width:number;height:number};
const axes=[new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)];
const letters=['X','Y','Z'],colors=['#c94b58','#288357','#387acb'];

export interface AngleRingProjection extends Point {
 /** The full ring, then the swept arc from zero to the angle, in screen pixels. */
 points:Point[];arc:Point[];
 /** Screen direction of travel at the end of the sweep, degrees clockwise from +x. */
 tangent:number;
 valueAt:(x:number,y:number)=>number|null;pointAt:(degrees:number)=>Point;
}
/** A ring about `axis` through `origin`: a screen lever's radius, or through `start`, which also
 *  sets where the angle is zero (a revolve's profile). `valueAt` maps the pointer to degrees. */
export function projectAngleRing(camera:Camera,rect:Rect,origin:Vector3,axis:Vector3,angleDegrees:number,start?:Vector3,screenRadius=false):AngleRingProjection|null {
 if(rect.width<=0||rect.height<=0||Math.abs(axis.length()-1)>1e-6||!Number.isFinite(angleDegrees))return null;
 const frozen=camera.clone();frozen.updateMatrixWorld(true);
 const screen=(point:Vector3):Point|null=>{const p=point.clone().project(frozen);return [p.x,p.y,p.z].every(Number.isFinite)&&p.z>=-1&&p.z<=1?{x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2}:null;};
 const rayAt=(x:number,y:number)=>{const ray=new Raycaster();ray.setFromCamera(new Vector2((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1),frozen);return ray.ray;};
 const centre=screen(origin);if(!centre)return null;
 const pixelsPerMM=Math.max(...axes.map(a=>{const p=screen(origin.clone().add(a));return p?Math.hypot(p.x-centre.x,p.y-centre.y):0;}));if(!Number.isFinite(pixelsPerMM)||pixelsPerMM<1e-9)return null;
 const lever=78/pixelsPerMM;
 const radial=start?start.clone().sub(origin).addScaledVector(axis,-axis.dot(start.clone().sub(origin))):null;
 const seed=radial&&radial.length()>1e-6?radial:axes.reduce((a,b)=>Math.abs(a.dot(axis))<=Math.abs(b.dot(axis))?a:b);
 const radius=!screenRadius&&radial&&radial.length()>1e-6?radial.length():lever;
 const u=seed.clone().addScaledVector(axis,-seed.dot(axis)).normalize(),v=new Vector3().crossVectors(axis,u);
 const point=(degrees:number)=>origin.clone().addScaledVector(u,radius*Math.cos(degrees*Math.PI/180)).addScaledVector(v,radius*Math.sin(degrees*Math.PI/180));
 const end=screen(point(angleDegrees));if(!end)return null;
 const plane=new Plane(axis,-axis.dot(origin));
 const valueAt=(x:number,y:number)=>{
  const ray=rayAt(x,y);if(Math.abs(ray.direction.dot(axis))<.05)return null;
  const hit=ray.intersectPlane(plane,new Vector3());if(!hit)return null;
  const d=hit.sub(origin);if(d.length()<radius*.02)return null;
  return Math.atan2(d.dot(v),d.dot(u))*180/Math.PI;
 };
 if(valueAt(end.x,end.y)===null)return null;
 const points=Array.from({length:65},(_,i)=>screen(point(i*360/64)));if(points.some(p=>!p))return null;
 const steps=Math.max(2,Math.ceil(Math.abs(angleDegrees)/4)),arc=Array.from({length:steps+1},(_,i)=>screen(point(angleDegrees*i/steps)));if(arc.some(p=>!p))return null;
 const ahead=screen(point(angleDegrees+Math.sign(angleDegrees||1)*2))??end;
 return {...end,points:points as Point[],arc:arc as Point[],tangent:Math.atan2(ahead.y-end.y,ahead.x-end.x)*180/Math.PI,valueAt,pointAt:degrees=>screen(point(degrees))!};
}

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
  const ring=projectAngleRing(frozen,rect,origin,new Vector3(...t.axisDirection),t.angleDegrees);if(!ring)return [];
  return [{key:'angle',label:'Rotate parts',color:'#387acb',x:ring.x,y:ring.y,points:ring.points,cyclic:360,valueAt:ring.valueAt,
   orbit:{angle:t.angleDegrees,pointAt:ring.pointAt}}];
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
