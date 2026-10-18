import{expect,it}from'vitest';
import{OrthographicCamera,PerspectiveCamera,Vector3}from'three/webgpu';
import{projectTransformGizmo}from'./transform-gizmo';
const rect={left:100,top:50,width:900,height:700},frame={centerMillimeters:[8,2,4] as [number,number,number],radiusMillimeters:15};
function camera(kind:string){const c=kind==='perspective'?new PerspectiveCamera(42,900/700,.1,10000):new OrthographicCamera(-80,80,60,-60,.1,10000);c.position.set(100,-130,160);c.up.set(0,0,1);c.lookAt(0,0,0);c.updateMatrixWorld(true);return c;}
function screen(c:ReturnType<typeof camera>,v:Vector3){const p=v.clone().project(c);return{x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2};}
it.each(['perspective','orthographic'])('projects all XYZ moves and recovers world distance with a frozen %s camera',kind=>{
 const c=camera(kind),delta=new Vector3(12,-4,8),origin=new Vector3(...frame.centerMillimeters).add(delta);
 const handles=projectTransformGizmo(c,rect,{frame,transform:{kind:'translate',translationMillimeters:delta.toArray()},uniform:true});expect(handles.map(h=>h.key)).toEqual(['moveX','moveY','moveZ']);
 for(const[h,i]of handles.map((h,i)=>[h,i]as const)){
  const axis=new Vector3().setComponent(i,1),p=screen(c,origin.clone().addScaledVector(axis,-18));
  expect(h.valueAt(p.x,p.y)).toBeCloseTo(-18,8);
  c.position.multiplyScalar(2);c.updateMatrixWorld(true);expect(h.valueAt(p.x,p.y)).toBeCloseTo(-18,8);c.position.multiplyScalar(.5);c.updateMatrixWorld(true);
 }
});
it.each(['perspective','orthographic'])('projects an arbitrary-axis rotation and preserves right-hand angles (%s)',kind=>{
 const c=camera(kind),axis=new Vector3(1,2,3).normalize(),origin=new Vector3(3,-4,5),t={kind:'rotate' as const,axisDirection:axis.toArray(),axisOriginMillimeters:origin.toArray(),angleDegrees:179};
 const [h]=projectTransformGizmo(c,rect,{frame,transform:t,uniform:true});expect(h.key).toBe('angle');expect(h.points.length).toBe(65);expect(h.valueAt(h.x,h.y)).toBeCloseTo(179,7);
 const seed=new Vector3(1,0,0),u=seed.addScaledVector(axis,-seed.dot(axis)).normalize(),v=new Vector3().crossVectors(axis,u);
 for(const angle of[-179,-45,0,90]){const p=screen(c,origin.clone().addScaledVector(u,20*Math.cos(angle*Math.PI/180)).addScaledVector(v,20*Math.sin(angle*Math.PI/180)));expect(h.valueAt(p.x,p.y)).toBeCloseTo(angle,7);}
});
it.each([true,false])('maps scale factors independently of camera zoom, uniform=%s',uniform=>{
 for(const zoom of[.5,1,3]){const c=camera('orthographic');c.zoom=zoom;c.updateProjectionMatrix();const factors:[number,number,number]=uniform?[2,2,2]:[2,3,.5];
 const h=projectTransformGizmo(c,rect,{frame,transform:{kind:'scale',centerMillimeters:[1,2,3],scaleFactors:factors},uniform});expect(h.length).toBe(uniform?1:3);
 for(const p of h)expect(p.valueAt(p.x,p.y)).toBeCloseTo(factors['XYZ'.indexOf(p.key.slice(-1))],7);
 }
});
it('hides end-on translation and edge-on rotation instead of producing unstable jumps',()=>{
 const c=camera('orthographic');c.position.set(0,0,100);c.up.set(0,1,0);c.lookAt(0,0,0);c.updateMatrixWorld(true);
 const h=projectTransformGizmo(c,rect,{frame,transform:{kind:'translate',translationMillimeters:[0,0,0]},uniform:true});expect(h.map(p=>p.key)).toEqual(['moveX','moveY']);
 expect(projectTransformGizmo(c,rect,{frame,transform:{kind:'rotate',axisOriginMillimeters:[0,0,0],axisDirection:[1,0,0],angleDegrees:0},uniform:true})).toEqual([]);
});
it('has no transform gizmo for Copy in place, bad bounds or off-camera origins',()=>{
 const c=camera('perspective');expect(projectTransformGizmo(c,rect,{frame,transform:{kind:'copy'},uniform:true})).toEqual([]);
 expect(projectTransformGizmo(c,rect,{frame:{...frame,radiusMillimeters:NaN},transform:{kind:'translate',translationMillimeters:[0,0,0]},uniform:true})).toEqual([]);
 expect(projectTransformGizmo(c,rect,{frame,transform:{kind:'translate',translationMillimeters:[1e8,-1e8,1e8]},uniform:true})).toEqual([]);
});
it.each(['perspective','orthographic'])('recovers signed distance along a selected reference axis (%s)',kind=>{
 const c=camera(kind),axis=new Vector3(.6,.8,0),translation=axis.clone().multiplyScalar(-12),origin=new Vector3(...frame.centerMillimeters).add(translation);
 const [h]=projectTransformGizmo(c,rect,{frame,transform:{kind:'translate',translationMillimeters:translation.toArray()},uniform:true,translationAxis:axis.toArray()});
 expect(h.key).toBe('distance');for(const delta of[-30,5,17]){const p=screen(c,origin.clone().addScaledVector(axis,delta));expect(h.valueAt(p.x,p.y)).toBeCloseTo(delta,8);}
});
