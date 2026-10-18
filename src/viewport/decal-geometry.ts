import * as THREE from 'three';
import {canonicalPlaneXDirection,type ImageCanvas} from '@aether/core/document';
import type {PartGeometryData} from '../domain';
import {planarFaceCandidates} from './planar-face-reference';
/** Clip actual face triangles to the decal rectangle. Holes remain holes. */
export function decalGeometry(canvas:ImageCanvas,part:PartGeometryData):THREE.BufferGeometry|null{
 const ref=canvas.face;if(!ref)return null;
 const candidates=planarFaceCandidates(part.topology,ref.normal,ref.anchor);if(candidates.length!==1)return null;
 const center=candidates[0],face=part.topology.find(f=>f.candidates.includes(center)),range=part.faceRanges.find(r=>r.faceId===face?.id);if(!range)return null;
 const z=new THREE.Vector3(...center.zAxis),x=new THREE.Vector3(...canonicalPlaneXDirection(center.zAxis)),y=new THREE.Vector3().crossVectors(z,x),origin=new THREE.Vector3(...center.origin).addScaledVector(x,canvas.xMillimeters).addScaledVector(y,canvas.yMillimeters);
 const angle=canvas.rotationDegrees*Math.PI/180; x.applyAxisAngle(z,angle);y.applyAxisAngle(z,angle);
 const positions:number[]=[],uvs:number[]=[];
 type Point={p:THREE.Vector3;u:number;v:number};
 const interpolate=(a:Point,b:Point,t:number):Point=>({p:a.p.clone().lerp(b.p,t),u:a.u+(b.u-a.u)*t,v:a.v+(b.v-a.v)*t});
 for(let i=range.start;i<range.start+range.count;i+=3){
  let polygon:Point[]=[];
  for(let j=0;j<3;j++){const index=part.triangles[i+j]*3,p=new THREE.Vector3(part.vertices[index],part.vertices[index+1],part.vertices[index+2]),delta=p.clone().sub(origin);polygon.push({p,u:delta.dot(x)/canvas.widthMillimeters+.5,v:delta.dot(y)/canvas.heightMillimeters+.5});}
  for(const [key,bound,sign] of [['u',0,1],['u',1,-1],['v',0,1],['v',1,-1]] as const){const clipped:Point[]=[];for(let j=0;j<polygon.length;j++){const a=polygon[j],b=polygon[(j+1)%polygon.length],insideA=(a[key]-bound)*sign>=0,insideB=(b[key]-bound)*sign>=0;if(insideA)clipped.push(a);if(insideA!==insideB)clipped.push(interpolate(a,b,(bound-a[key])/(b[key]-a[key])));}polygon=clipped;}
  for(let j=1;j<polygon.length-1;j++)for(const point of [polygon[0],polygon[j],polygon[j+1]]){positions.push(...point.p.toArray());uvs.push(point.u,point.v);}
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));return geometry;
}
