import {expect,it} from 'vitest';
import {OrthographicCamera,PerspectiveCamera,Raycaster,Vector2,Vector3} from 'three/webgpu';
import {extrusionAxisDepth} from './extrusion-axis';
it.each(['perspective','orthographic'])('recovers signed extrusion depths from %s pointer rays',projection=>{
 const camera=projection==='perspective'?new PerspectiveCamera(42,1.5,.1,10000):new OrthographicCamera(-100,100,80,-80,.1,10000);
 const origin=new Vector3(10,20,5),normal=new Vector3(0,0,1);
 camera.position.copy(origin).add(new Vector3(100,-100,100));camera.up.set(0,0,1);camera.lookAt(origin);camera.updateMatrixWorld(true);
 for(const depth of [-30,0,25,80]){
  const screen=origin.clone().addScaledVector(normal,depth).project(camera);
  const ray=new Raycaster();ray.setFromCamera(new Vector2(screen.x,screen.y),camera);
  expect(extrusionAxisDepth(ray.ray,origin,normal)).toBeCloseTo(depth,8);
 }
});
it('declines an unstable end-on drag instead of jumping the depth',()=>{
 const camera=new PerspectiveCamera(42,1,.1,1000);camera.position.set(0,0,100);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
 const ray=new Raycaster();ray.setFromCamera(new Vector2(0,0),camera);
 expect(extrusionAxisDepth(ray.ray,new Vector3(),new Vector3(0,0,1))).toBeNull();
});
