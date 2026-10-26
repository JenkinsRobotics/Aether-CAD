import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {mountTransformManipulator} from '@aether/ui';
import {projectSelectionManipulator,transformMatrix,type Point3,type ProjectedManipulatorHandle} from '../src/viewport/selection-manipulator-math';

/** Same presentation and projection used by CAD. Only this specimen's scene is local. */
export function TransformGizmoDemo(){
 const host=useRef<HTMLDivElement>(null);
 const [readout,setReadout]=useState('Drag arrows to move, pads to move in a plane, curved arrows to rotate.');
 useEffect(()=>{
  const element=host.current;if(!element)return;
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));element.append(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(42,1,.1,5000);camera.up.set(0,0,1);camera.position.set(140,-180,150);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  scene.add(new THREE.HemisphereLight(0xffffff,0x6f8291,2.4));const light=new THREE.DirectionalLight(0xffffff,2.2);light.position.set(100,-100,200);scene.add(light);
  const grid=new THREE.GridHelper(600,24,0x8895a5,0x394250);grid.rotation.x=Math.PI/2;grid.position.z=-20;scene.add(grid);
  const geometry=new THREE.BoxGeometry(70,50,40),material=new THREE.MeshStandardMaterial({color:0x79a9c2,roughness:.55});const body=new THREE.Mesh(geometry,material);scene.add(body);
  let pivot:Point3=[0,0,0],copy=false,handles:ProjectedManipulatorHandle[]=[],raf=0;
  const copies:THREE.Mesh[]=[];
  let drag:{handle:ProjectedManipulatorHandle;sample:Point3|number|null;pivot:Point3;matrix:THREE.Matrix4;angle:number;target:THREE.Mesh}|null=null;
  const freePoint=(x:number,y:number)=>{const r=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((x-r.left)/r.width*2-1,1-(y-r.top)/r.height*2),camera);const point=ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()),new THREE.Vector3(...pivot)),new THREE.Vector3());return point?.toArray();};
  const widget=mountTransformManipulator(element,{
   onStart(handle,e){const projected=handles.find(h=>h.id===handle.id);if(!projected)return false;body.updateMatrix();const target=copy&&handle.kind!=='pivot'?body.clone():body;if(target!==body)scene.add(target);drag={handle:projected,sample:projected.sample(e.clientX,e.clientY),pivot:[...pivot],matrix:body.matrix.clone(),angle:0,target};},
   onMove(handle,e){if(!drag)return;if(handle.kind==='pivot'){pivot=freePoint(e.clientX,e.clientY)??pivot;return;}const sample=drag.handle.sample(e.clientX,e.clientY);if(sample===null)return;
    if(typeof sample==='number'&&typeof drag.sample==='number'){drag.angle+=((sample-drag.sample+540)%360)-180;drag.sample=sample;transformMatrix({kind:'rotate',axisOriginMillimeters:drag.pivot,axisDirection:drag.handle.axis!,angleDegrees:drag.angle}).multiply(drag.matrix).decompose(drag.target.position,drag.target.quaternion,drag.target.scale);setReadout(`Rotate ${drag.angle.toFixed(1)}°`);}
    else if(Array.isArray(sample)&&Array.isArray(drag.sample)){const start=drag.sample,delta=sample.map((v,i)=>v-start[i]) as Point3;transformMatrix({kind:'translate',translationMillimeters:delta}).multiply(drag.matrix).decompose(drag.target.position,drag.target.quaternion,drag.target.scale);pivot=drag.pivot.map((v,i)=>v+delta[i]) as Point3;setReadout(`Move ${delta.map(v=>v.toFixed(1)).join(', ')} mm`);}
   },
   onEnd(_handle,cancelled){if(!drag)return;if(cancelled){pivot=drag.pivot;if(drag.target!==body)drag.target.removeFromParent();else drag.matrix.decompose(body.position,body.quaternion,body.scale);}else if(drag.target!==body){copies.push(drag.target);copy=false;}drag=null;},
   onCopy(){copy=!copy;setReadout(copy?'The next movement makes a copy.':'Move the selected part.');},
   onResetPivot(){pivot=body.position.toArray();setReadout('Pivot reset to the part center.');},
  });
  const place=(e:PointerEvent)=>{if(e.shiftKey&&e.button===0){pivot=freePoint(e.clientX,e.clientY)??pivot;setReadout('Pivot placed without moving the part.');}};renderer.domElement.addEventListener('pointerdown',place);
  const draw=()=>{const width=element.clientWidth||520,height=380;if(renderer.domElement.width!==Math.round(width*renderer.getPixelRatio())){renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();}handles=projectSelectionManipulator(camera,renderer.domElement.getBoundingClientRect(),pivot);const center=handles.find(h=>h.id==='pivot');widget.update(handles,{copy,copyPosition:center?{x:center.x,y:Math.max(...handles.map(h=>h.y))+30}:undefined});renderer.render(scene,camera);raf=requestAnimationFrame(draw);};draw();
  return()=>{cancelAnimationFrame(raf);widget.dispose();renderer.domElement.removeEventListener('pointerdown',place);geometry.dispose();material.dispose();grid.geometry.dispose();(grid.material as THREE.Material).dispose();copies.forEach(c=>c.removeFromParent());renderer.dispose();renderer.domElement.remove();};
 },[]);
 return <div><div ref={host} style={{position:'relative',height:380,overflow:'hidden',borderRadius:8}}/><p aria-live="polite">{readout}</p><small>Drag the blue pivot or Shift-click to place it. Double-click the pivot to recenter. Escape cancels a drag.</small></div>;
}
