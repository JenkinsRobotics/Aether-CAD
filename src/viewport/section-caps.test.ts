import {expect,it} from 'vitest';
import {BoxGeometry,Plane,TorusGeometry,Vector3} from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {sectionCapGeometry} from './section-caps';
function area(geometry:ReturnType<typeof sectionCapGeometry>) {
  const p=geometry.getAttribute('position'),a=new Vector3(),b=new Vector3(),c=new Vector3();let sum=0;
  for(let i=0;i<p.count;i+=3){a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);sum+=b.sub(a).cross(c.sub(a)).length()/2;}return sum;
}
it('places a flat cap on the moving cut and trims it by the other planes',()=>{
  const box=new BoxGeometry(20,20,20),x=new Plane(new Vector3(-1,0,0),2),y=new Plane(new Vector3(0,-1,0),0);
  const cap=sectionCapGeometry(box,[x]);expect(area(cap)).toBeCloseTo(400);
  const p=cap.getAttribute('position');for(let i=0;i<p.count;i++)expect(p.getX(i)).toBeCloseTo(2);
  expect(area(sectionCapGeometry(box,[x,y]))).toBeCloseTo(440); // 20×10 + 12×20
  expect(area(sectionCapGeometry(box,[new Plane(new Vector3(-1,0,0),30)]))).toBe(0);
});
it('preserves the bore in an annular section instead of filling it',()=>{
  const torus=new TorusGeometry(10,3,24,80),cap=sectionCapGeometry(torus,[new Plane(new Vector3(0,0,-1),.1)]);
  expect(area(cap)).toBeGreaterThan(350);expect(area(cap)).toBeLessThan(390);
  const p=cap.getAttribute('position');for(let i=0;i<p.count;i+=3){const center=new Vector3();for(let j=0;j<3;j++)center.add(new Vector3().fromBufferAttribute(p,i+j));center.divideScalar(3);expect(Math.hypot(center.x,center.y)).toBeGreaterThan(6.8);}
});

it('caps only exposed interiors, never an exterior face coincident with the section', () => {
  const box = new BoxGeometry(20,20,20);
  for (const sign of [-1, 1]) for (const offset of [-10, 10, 11]) {
    expect(area(sectionCapGeometry(box, [new Plane(new Vector3(0,0,sign), offset)]))).toBe(0);
  }
  expect(area(sectionCapGeometry(box, [new Plane(new Vector3(0,0,1), 9.99)]))).toBeCloseTo(400);
  // One shell on each side is not evidence that either shell was bisected.
  const shells = mergeGeometries([box.clone().translate(0,0,10), box.clone().translate(30,0,-10)]);
  expect(area(sectionCapGeometry(shells, [new Plane(new Vector3(0,0,1), 0)]))).toBe(0);
});

it('retains diagonal cuts through existing edges and avoids duplicate coincident caps', () => {
  const box = new BoxGeometry(20,20,20), plane = new Plane(new Vector3(1,1,0).normalize(),0);
  const cap = sectionCapGeometry(box, [plane, plane.clone()]);
  expect(area(cap)).toBeCloseTo(400*Math.SQRT2);
  expect(cap.groups[1].count).toBe(0);
  const p = cap.getAttribute('position');
  for (let i=0;i<p.count;i++) expect(plane.distanceToPoint(new Vector3().fromBufferAttribute(p,i))).toBeCloseTo(0);
});

it('refreshes culling bounds when vertex data moves, including a replaced position buffer', () => {
  const box = new BoxGeometry(20,20,20), cut = new Plane(new Vector3(-1,0,0),100);
  expect(area(sectionCapGeometry(box,[cut]))).toBe(0);
  const position = box.getAttribute('position');
  for(let i=0;i<position.count;i++) position.setX(i,position.getX(i)+100);
  position.needsUpdate = true;
  expect(area(sectionCapGeometry(box,[cut]))).toBeCloseTo(400);
  box.setAttribute('position',new BoxGeometry(20,20,20).getAttribute('position'));
  expect(area(sectionCapGeometry(box,[cut]))).toBe(0);
});
