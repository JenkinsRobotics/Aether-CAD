import {decalGeometry} from "./decal-geometry";
import type {PartGeometryData} from "../domain";
import * as THREE from 'three';
import {principalFrame,type ImageCanvas} from '@aether/core/document';
export class ImageCanvasLayer {
 readonly group=new THREE.Group();
 private signature='';
 set(canvases:readonly ImageCanvas[],parts:ReadonlyMap<string,{data:PartGeometryData;group:THREE.Group;visible:boolean}>=new Map()){
  const signature=JSON.stringify(canvases);if(signature===this.signature&&!canvases.some(c=>c.face))return;this.signature=signature;
  for(const child of [...this.group.children]){const mesh=child as THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>;mesh.geometry.dispose();mesh.material.map?.dispose();mesh.material.dispose();this.group.remove(mesh);}
  for(const canvas of canvases){
   if(!canvas.visible)continue;
   const part=canvas.face?parts.get(canvas.face.bodyId):undefined;
   const decal=canvas.face&&part?.visible?decalGeometry(canvas,part.data):null;
   if(canvas.face&&!decal)continue;
   const texture=new THREE.TextureLoader().load(canvas.dataUrl);texture.colorSpace=THREE.SRGBColorSpace;
   const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:canvas.opacity,side:THREE.DoubleSide,depthWrite:false,polygonOffset:Boolean(canvas.face),polygonOffsetFactor:-4,polygonOffsetUnits:-4});
   const mesh=new THREE.Mesh(decal??new THREE.PlaneGeometry(canvas.widthMillimeters,canvas.heightMillimeters),material);
   if(decal&&part){part.group.updateWorldMatrix(true,false);mesh.applyMatrix4(part.group.matrixWorld);mesh.name=canvas.name;this.group.add(mesh);continue;}
   const frame=principalFrame(canvas.plane,canvas.offsetMillimeters),x=new THREE.Vector3(...frame.xDirection),z=new THREE.Vector3(...frame.normal),y=new THREE.Vector3().crossVectors(z,x);
   mesh.position.set(...frame.originMillimeters).addScaledVector(x,canvas.xMillimeters).addScaledVector(y,canvas.yMillimeters);
   mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));mesh.rotateZ(canvas.rotationDegrees*Math.PI/180);
   mesh.name=canvas.name;this.group.add(mesh);
  }
 }
}
