import { BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, SphereGeometry, Vector3 } from 'three/webgpu';
import { accelerateSurfacePicking } from '../../src/viewport/surface-picking';

const median = (values:number[]) => values.slice().sort((a,b)=>a-b)[Math.floor(values.length/2)];
(window as any).pickingPerformance = (count:number, width:number, height:number) => {
  const source = new SphereGeometry(10,width,height);
  const meshes = Array.from({length:count}, (_,i) => {
    const geometry=new BufferGeometry();
    geometry.setAttribute('position',source.getAttribute('position'));
    geometry.setAttribute('normal',source.getAttribute('normal'));
    geometry.setIndex(source.index);
    geometry.addGroup(0,geometry.index!.count,0);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh=new Mesh(geometry,[new MeshBasicMaterial({side:DoubleSide})]);
    mesh.position.set(i%13*25,Math.floor(i/13)*25,0); mesh.updateMatrixWorld(true);
    return mesh;
  });
  const rays=Array.from({length:300},(_,i)=>{
    const center=meshes[i%count].position;
    const origin=center.clone().add(new Vector3(Math.sin(i*1.7)*15,Math.cos(i*.7)*15,30));
    return new Raycaster(origin,center.clone().add(new Vector3(2,1,0)).sub(origin).normalize());
  });
  const result = () => rays.map(ray=>ray.intersectObjects(meshes,false));
  const measure=()=>{const samples=[];for(let i=0;i<7;i++){const start=performance.now();result();if(i>1)samples.push((performance.now()-start)/rays.length);}return {medianMs:median(samples),samples};};
  const expected=result(), before=measure(), start=performance.now();
  meshes.forEach(accelerateSurfacePicking);
  const buildMs=performance.now()-start;
  const actual=result();
  let mismatches=0;
  expected.forEach((list,i)=>{
    const found=actual[i];
    if(list.length!==found.length||list.some((hit,j)=>hit.faceIndex!==found[j].faceIndex||hit.object!==found[j].object||hit.point.distanceTo(found[j].point)>1e-6))mismatches++;
  });
  const after=measure();
  meshes.forEach(mesh=>{mesh.geometry.dispose();mesh.material.forEach(m=>m.dispose());});
  source.dispose();
  return {count,triangles:source.index!.count/3*count,rays:rays.length,buildMs,before,after,mismatches};
};
