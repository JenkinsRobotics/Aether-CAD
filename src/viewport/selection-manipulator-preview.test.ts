import {expect,it,vi} from 'vitest';
import {Group,Mesh,BoxGeometry,MeshBasicMaterial,Vector3} from 'three/webgpu';
import {MateViewport} from '../viewer';
function fixture(){
 const viewer=Object.create(MateViewport.prototype) as any;
 const root=new Group(),group=new Group(),geometry=new BoxGeometry(10,20,5),material=new MeshBasicMaterial();
 group.add(new Mesh(geometry,material));group.position.set(3,4,5);root.add(group);root.updateMatrixWorld(true);
 viewer.parts=new Map([['part',{group}]]);viewer.manipulatorPreview=[];
 return{viewer:viewer as MateViewport,root,group,geometry,material};
}
it('previews from the captured placement on each move and restores it on cancellation',()=>{
 const f=fixture();f.viewer.previewManipulatorTransform(['part'],{kind:'translate',translationMillimeters:[5,0,0]},false);expect(f.group.position.toArray()).toEqual([8,4,5]);
 f.viewer.previewManipulatorTransform(['part'],{kind:'translate',translationMillimeters:[7,0,0]},false);expect(f.group.position.toArray()).toEqual([10,4,5]);
 f.viewer.clearManipulatorPreview();expect(f.group.position.toArray()).toEqual([3,4,5]);
});
it('a Copy preview leaves the source placement intact and releases only the temporary node',()=>{
 const f=fixture(),dispose=vi.spyOn(f.geometry,'dispose');f.viewer.previewManipulatorTransform(['part'],{kind:'translate',translationMillimeters:[5,0,0]},true);
 expect(f.root.children).toHaveLength(2);expect(f.group.position.toArray()).toEqual([3,4,5]);expect(f.root.children[1].position.toArray()).toEqual([8,4,5]);
 f.viewer.clearManipulatorPreview();expect(f.root.children).toEqual([f.group]);expect(dispose).not.toHaveBeenCalled();
});
it('rotation preview uses the chosen pivot, not the object or world origin',()=>{
 const f=fixture();f.viewer.previewManipulatorTransform(['part'],{kind:'rotate',axisOriginMillimeters:[3,4,0],axisDirection:[0,1,0],angleDegrees:90},false);
 expect(f.group.position.distanceTo(new Vector3(8,4,0))).toBeLessThan(1e-8);f.viewer.clearManipulatorPreview();expect(f.group.position.toArray()).toEqual([3,4,5]);expect(f.group.quaternion.w).toBe(1);
});
