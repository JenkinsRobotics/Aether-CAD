import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { createCADCameraControls } from './camera-controls';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
let dom, controls;
afterEach(()=>{ controls?.dispose(); dom?.window.close(); vi.unstubAllGlobals(); });
function setup(up = [0,0,1], position = [0,-100,0], orthographic = false) {
  dom = new JSDOM('<canvas></canvas>'); vi.stubGlobal('window',dom.window); vi.stubGlobal('document',dom.window.document);
  const element = document.querySelector('canvas');
  Object.defineProperty(element,'clientWidth',{value:800});
  Object.defineProperty(element,'clientHeight',{value:600});
  element.getBoundingClientRect = () => ({ left:0, top:0, width:800, height:600 });
  element.setPointerCapture = vi.fn(); element.releasePointerCapture = vi.fn();
  const camera = orthographic ? new OrthographicCamera(-80,80,60,-60,.1,10000) : new PerspectiveCamera(42,800/600,.1,10000); camera.position.set(...position); camera.up.set(...up);
  const change = vi.fn(); controls = createCADCameraControls(camera,element,change);
  const event = (type,x,y,button=2) => {
    const e = new dom.window.MouseEvent(type,{clientX:x,clientY:y,button,bubbles:true});
    Object.defineProperty(e,'pointerId',{value:1}); Object.defineProperty(e,'pointerType',{value:'mouse'});
    element.dispatchEvent(e); controls.update();
  };
  const drag = (dx,dy,button=2) => { event('pointerdown',400,300,button); for(let i=1;i<=40;i++)event('pointermove',400+dx*i/40,300+dy*i/40,button);event('pointerup',400+dx,300+dy,button); };
  return {camera,element,change,event,drag};
}
it.each([[0,0,1],[0,1,0]])('tilts through both poles and completes 360 degrees with workspace up %j', (x,y,z)=>{
  const up=[x,y,z], t=setup(up, z ? [0,-100,0] : [0,0,100]);
  const start=t.camera.position.clone(), initialUp=t.camera.up.clone(), distance=start.length();
  t.drag(0,200); // quarter turn: reaches a pole
  const pole=t.camera.position.clone();
  expect(Math.abs(pole.clone().normalize().dot(new Vector3(...up)))).toBeCloseTo(1,8);
  t.drag(0,200); // must pass the pole rather than stop there
  expect(t.camera.position.distanceTo(start.clone().negate())).toBeLessThan(1e-7);
  t.drag(0,400);
  expect(t.camera.position.distanceTo(start)).toBeLessThan(1e-7);
  expect(t.camera.up.distanceTo(initialUp)).toBeLessThan(1e-7);
  expect(t.camera.position.length()).toBeCloseTo(distance,8);
  expect(t.change).toHaveBeenCalled();
});
it('starts exactly at Top, rotates past it, and normal-view reset stays still after updates',()=>{
  const t=setup([0,1,0],[0,0,100]);
  t.drag(0,200); expect(Math.abs(t.camera.position.z)).toBeLessThan(1e-7);
  controls.target.set(0,0,0);t.camera.position.set(0,0,100);t.camera.up.set(0,1,0);controls.update();
  const p=t.camera.position.clone(), q=t.camera.quaternion.clone();
  for(let i=0;i<120;i++)controls.update();
  expect(t.camera.position.distanceTo(p)).toBe(0);expect(t.camera.quaternion.angleTo(q)).toBeLessThan(1e-7);
  // Principal XZ and YZ planes must project to lines in this centered Top view.
  t.camera.updateMatrixWorld();
  for(const normal of [new Vector3(1,0,0),new Vector3(0,1,0)]) {
    const points=[];
    for(const side of [-50,50])for(const depth of [-50,50])points.push(new Vector3(normal.x ? 0 : side,normal.x ? side : 0,depth).project(t.camera));
    const thickness=normal.x ? Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)) : Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y));
    expect(thickness).toBeLessThan(1e-10);
  }
});
it('retains middle pan and wheel zoom while left selection and D do not drive the camera',()=>{
  const t=setup();const initial=t.camera.position.clone();
  window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'d',code:'KeyD'}));
  t.drag(100,80,0);expect(t.camera.position.distanceTo(initial)).toBe(0);
  window.dispatchEvent(new dom.window.KeyboardEvent('keyup',{key:'d',code:'KeyD'}));
  const offset=t.camera.position.clone().sub(controls.target);t.drag(100,40,1);
  expect(controls.target.length()).toBeGreaterThan(0);expect(t.camera.position.clone().sub(controls.target).distanceTo(offset)).toBeLessThan(1e-7);
  t.element.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));controls.update();
  expect(t.camera.position.distanceTo(controls.target)).toBeLessThan(offset.length());
});

it('orthographic controls rotate, pan and zoom without losing the target',()=>{
  const t=setup([0,1,0],[0,0,100],true);
  const initial=t.camera.position.clone();
  t.drag(100,80);
  expect(t.camera.position.distanceTo(initial)).toBeGreaterThan(1);
  expect(t.camera.position.distanceTo(controls.target)).toBeCloseTo(100,8);
  t.drag(100,40,1);
  expect(controls.target.length()).toBeGreaterThan(0);
  const distance=t.camera.position.distanceTo(controls.target);
  t.element.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));controls.update();
  expect(t.camera.zoom).toBeGreaterThan(1);
  expect(t.camera.position.distanceTo(controls.target)).toBeCloseTo(distance,8);
});
