import * as THREE from 'three/webgpu';
import { SectionLayer } from '../../src/viewport/section-layer';
import { TransparentViewportOutput } from '../../src/viewport/transparent-output';
const renderer = new THREE.WebGPURenderer({antialias:true,alpha:true,forceWebGL:location.search.includes('webgl')});
renderer.setSize(400,400); renderer.setPixelRatio(1); renderer.setClearColor(0x101112,1);
document.body.style.margin='0'; document.body.append(renderer.domElement);
await renderer.init();
const scene=new THREE.Scene(), root=new THREE.Group(), overlay=new THREE.Group(); scene.add(root,overlay);
const layer=new SectionLayer(root,overlay), group=new THREE.Group(), geometry=new THREE.BoxGeometry(20,20,20);
group.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0x68a5c6})));
layer.adopt('box',group,geometry);
const camera=new THREE.OrthographicCamera(-15,15,15,-15,.1,1000); camera.position.set(0,0,100); camera.lookAt(0,0,0);
const output=new TransparentViewportOutput(renderer,scene,camera);
window.sectionCheck={async render({offset=null,second=false,reversed=false,excluded=false,top=false,oblique=false,tilted=false}:{offset?:number|null;second?:boolean;reversed?:boolean;excluded?:boolean;top?:boolean;oblique?:boolean;tilted?:boolean}={}) {
 camera.position.set(...(tilted ? [60,-80,70] : [0,0,100]) as [number,number,number]);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
 const planes=offset===null?[]:[{id:'x',plane:{label:'Section',originMillimeters:[0,0,0] as const,normal:(top?[0,0,1]:[1,0,0]) as readonly [number,number,number]},offsetMillimeters:offset,reversed},
   ...(second?[{id:'y',plane:{label:'Front',originMillimeters:[0,0,0] as const,normal:[0,1,0] as const},offsetMillimeters:0}]:[])];
 if(oblique && planes.length) planes[0].plane.normal = new THREE.Vector3(.31,-.47,1).normalize().toArray();
 layer.apply(offset===null?null:{planes,activePlaneId:'x',mode:'exclude',items:excluded?[{id:'box',label:'Box'}]:[]},[group],new THREE.Box3().setFromObject(group),false);
 // Wait for presentation as well as asynchronous pipeline creation on both backends.
 for(let i=0;i<3;i++){await output.renderAsync(camera);await new Promise(requestAnimationFrame);}
 // Independent analytic ray/box/half-space oracle. It verifies the visible cut
 // and cap depth, not just that a screenshot changed after adjusting a field.
 const expected=(x:number,y:number)=>{
  const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(x/200-1,1-y/200),camera);
  let near=-Infinity,far=Infinity;
  for(let axis=0;axis<3;axis++){
   const o=ray.ray.origin.getComponent(axis),d=ray.ray.direction.getComponent(axis);
   if(Math.abs(d)<1e-10){if(o < -10 || o > 10)return 'background';continue;}
   const a=(-10-o)/d,b=(10-o)/d;near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));
  }
  const surface=near;
  if(!excluded) for(const cut of planes){
   const n=new THREE.Vector3(...cut.plane.normal).multiplyScalar(cut.reversed?-1:1);
   const d=(cut.offsetMillimeters*(cut.reversed?-1:1))-n.dot(ray.ray.origin),denominator=n.dot(ray.ray.direction);
   if(Math.abs(denominator)<1e-10){if(d < 0)return 'background';continue;}
   const t=d/denominator;if(denominator>0)far=Math.min(far,t);else near=Math.max(near,t);
  }
  return near >= far-1e-6 || far<0 ? 'background' : near>surface+1e-5 ? 'cap' : 'body';
 };
 const probes=[];
 for(let y=4;y<398;y+=8)for(let x=4;x<398;x+=8){const type=expected(x,y);if([[2,0],[-2,0],[0,2],[0,-2]].every(([dx,dy])=>expected(x+dx,y+dy)===type))probes.push({x,y,type});}
 return {backend:renderer.backend.isWebGPUBackend?'webgpu':'webgl',probes};
}};
