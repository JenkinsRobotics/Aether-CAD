import { expect,it } from 'vitest';
import { OrthographicCamera,PerspectiveCamera,Vector3 } from 'three/webgpu';
import { projectSelectionManipulator,transformMatrix,type Point3 } from './selection-manipulator-math';
const rect={left:100,top:50,width:900,height:700},pivot:Point3=[8,2,4];
function camera(kind:string){const c=kind==='perspective'?new PerspectiveCamera(42,900/700,.1,10000):new OrthographicCamera(-80,80,60,-60,.1,10000);c.position.set(100,-130,160);c.up.set(0,0,1);c.lookAt(0,0,0);c.updateMatrixWorld(true);return c;}
function screen(c:ReturnType<typeof camera>,v:Vector3){const p=v.clone().project(c);return{x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2};}
it.each(['perspective','orthographic'])('recovers axis and plane movements in world coordinates with a frozen %s camera',kind=>{
 const c=camera(kind),handles=projectSelectionManipulator(c,rect,pivot);expect(handles).toHaveLength(10);
 const origin=new Vector3(...pivot);
 for(let i=0;i<3;i++){
  const axis=new Vector3().setComponent(i,1),at=screen(c,origin.clone().addScaledVector(axis,-18));
  const h=handles.find(h=>h.id===`move${'XYZ'[i]}`)!;
  const result=h.sample(at.x,at.y) as Point3;expect(result[i]).toBeCloseTo(-18,8);expect(result[(i+1)%3]).toBeCloseTo(0);
  const delta=new Vector3().setComponent((i+1)%3,11).setComponent((i+2)%3,-7),p=screen(c,origin.clone().add(delta));
  const plane=handles.find(h=>h.id===`plane${'XYZ'[i]}`)!,sample=plane.sample(p.x,p.y) as Point3;
  sample.forEach((value,index)=>expect(value).toBeCloseTo(delta.toArray()[index],8));
  c.position.multiplyScalar(2);c.updateMatrixWorld(true);expect((h.sample(at.x,at.y) as Point3)[i]).toBeCloseTo(-18,8);c.position.multiplyScalar(.5);c.updateMatrixWorld(true);
 }
});
it('rotation preserves a relocated pivot instead of rotating around world origin',()=>{
 const matrix=transformMatrix({kind:'rotate',axisOriginMillimeters:[10,20,5],axisDirection:[0,0,1],angleDegrees:90});
 expect(new Vector3(10,20,5).applyMatrix4(matrix).distanceTo(new Vector3(10,20,5))).toBeLessThan(1e-9);
 expect(new Vector3(12,20,5).applyMatrix4(matrix).distanceTo(new Vector3(10,22,5))).toBeLessThan(1e-9);
});
it('hides unstable end-on axes and edge-on planes',()=>{
 const c=camera('orthographic');c.position.set(0,0,100);c.up.set(0,1,0);c.lookAt(0,0,0);c.updateMatrixWorld(true);
 expect(projectSelectionManipulator(c,rect,[0,0,0]).map(h=>h.id)).toEqual(['moveX','moveY','planeZ','rotateZ','pivot']);
});
