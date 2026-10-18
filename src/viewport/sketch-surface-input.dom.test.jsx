import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import { PerspectiveCamera } from 'three';
import { createCADCameraControls } from './camera-controls';
import { bindSketchCameraInput, isSketchCameraGesture } from './sketch-surface-input';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
let dom, controls, dispose;
afterEach(()=>{dispose?.();controls?.dispose();dom?.window.close();vi.unstubAllGlobals();});
function setup() {
  dom=new JSDOM('<canvas></canvas><svg><circle id="fill"/><path id="edge"/><text id="label">Dimension</text></svg>');
  vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document);
  dom.window.PointerEvent=class extends dom.window.MouseEvent { constructor(type,init={}) { super(type,init); this.pointerId=init.pointerId??1;this.pointerType=init.pointerType??'mouse'; } };
  const canvas=document.querySelector('canvas'), svg=document.querySelector('svg');
  canvas.getBoundingClientRect=()=>({left:0,top:0,width:800,height:600});canvas.setPointerCapture=vi.fn();canvas.releasePointerCapture=vi.fn();
  const camera=new PerspectiveCamera(42,800/600,.1,10000);camera.position.set(0,-100,0);camera.up.set(0,0,1);
  controls=createCADCameraControls(camera,canvas,()=>{});dispose=bindSketchCameraInput(svg,canvas);
  const send=(target,type,x,y,button=2,buttons=2)=>{const e=new dom.window.PointerEvent(type,{clientX:x,clientY:y,button,buttons,bubbles:true,cancelable:true});target.dispatchEvent(e);controls.update();return e;};
  return {canvas,svg,camera,send};
}
it.each(['svg','#fill','#edge','#label'])('right-drag over %s rotates the same camera and suppresses the browser menu',selector=>{
  const t=setup(), target=document.querySelector(selector), start=t.camera.position.clone();
  t.send(target,'pointerdown',400,300);t.send(target,'pointermove',420,340);t.send(target,'pointerup',420,340,2,0);
  expect(t.camera.position.distanceTo(start)).toBeGreaterThan(1);
  const context=new dom.window.MouseEvent('contextmenu',{button:2,bubbles:true,cancelable:true});target.dispatchEvent(context);expect(context.defaultPrevented).toBe(true);
  expect(t.canvas.setPointerCapture).toHaveBeenCalledWith(1);
});
it('keeps left selection in the sketch while forwarding middle pan and wheel zoom',()=>{
  const t=setup(), target=document.querySelector('#fill'), down=vi.fn();target.addEventListener('pointerdown',down);
  const original=t.camera.position.clone();t.send(target,'pointerdown',400,300,0,1);t.send(target,'pointermove',420,340,0,1);t.send(target,'pointerup',420,340,0,0);
  expect(down).toHaveBeenCalledOnce();expect(t.camera.position.distanceTo(original)).toBe(0);
  t.send(target,'pointerdown',400,300,1,4);t.send(target,'pointermove',420,340,1,4);t.send(target,'pointerup',420,340,1,0);expect(controls.target.length()).toBeGreaterThan(0);
  const distance=t.camera.position.distanceTo(controls.target);
  target.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));controls.update();expect(t.camera.position.distanceTo(controls.target)).toBeLessThan(distance);
});
it('cancels navigation and removes forwarding listeners when the sketch closes',()=>{
  const t=setup(), target=document.querySelector('#fill');t.send(target,'pointerdown',400,300);t.send(target,'pointercancel',400,300,-1,0);
  const before=t.camera.position.clone();dispose();t.send(target,'pointerdown',400,300);t.send(target,'pointermove',500,500);expect(t.camera.position.distanceTo(before)).toBe(0);
  const context=new dom.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true});target.dispatchEvent(context);expect(context.defaultPrevented).toBe(false);
});

it('does not bounce forwarded navigation moves between canvas and sketch',()=>{
  const t=setup(), count=vi.fn();
  t.canvas.addEventListener('pointermove',e=>{
    count();
    if (!isSketchCameraGesture(e)) t.svg.dispatchEvent(new dom.window.PointerEvent(e.type,e));
  });
  const target=document.querySelector('#fill');
  t.send(target,'pointerdown',400,300);t.send(target,'pointermove',420,340,-1,2);t.send(target,'pointerup',420,340,2,0);
  expect(count).toHaveBeenCalledOnce();
});
