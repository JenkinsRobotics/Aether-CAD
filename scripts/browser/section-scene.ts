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
window.sectionCheck={async render({offset=null,second=false,reversed=false,excluded=false,top=false}:{offset?:number|null;second?:boolean;reversed?:boolean;excluded?:boolean;top?:boolean}={}) {
 const planes=offset===null?[]:[{id:'x',plane:{label:'Section',originMillimeters:[0,0,0] as const,normal:(top?[0,0,1]:[1,0,0]) as readonly [number,number,number]},offsetMillimeters:offset,reversed},
   ...(second?[{id:'y',plane:{label:'Front',originMillimeters:[0,0,0] as const,normal:[0,1,0] as const},offsetMillimeters:0}]:[])];
 layer.apply(offset===null?null:{planes,activePlaneId:'x',mode:'exclude',items:excluded?[{id:'box',label:'Box'}]:[]},[group],new THREE.Box3().setFromObject(group),false);
 // Wait for presentation as well as asynchronous pipeline creation on both backends.
 for(let i=0;i<3;i++){await output.renderAsync(camera);await new Promise(requestAnimationFrame);}
 return {backend:renderer.backend.isWebGPUBackend?'webgpu':'webgl'};
}};
