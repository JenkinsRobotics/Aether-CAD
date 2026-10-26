import {createRequire} from 'node:module';
import {expect,it,vi} from 'vitest';
import {mountSectionHandle} from './section-handle';
import { projectSection } from './section-projection';
import { Box3, PerspectiveCamera } from 'three/webgpu';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
it('shows opposing normal arrows and previews movement, keyboard steps and typed offsets with drag cancellation',()=>{
  const dom=new JSDOM('<body><main/></body>');
  for(const key of ['window','document','CustomEvent'])vi.stubGlobal(key,dom.window[key]);
  vi.stubGlobal('requestAnimationFrame',()=>0);vi.stubGlobal('cancelAnimationFrame',()=>{});
  let cut={id:'x',plane:{label:'Right',originMillimeters:[0,0,0],normal:[1,0,0]},offsetMillimeters:5};
  const change=vi.fn(value=>{cut={...cut,offsetMillimeters:value};});
  window.addEventListener('aether-section-handle',event=>event.detail.respond({start:{x:100,y:100},end:{x:170,y:100},valueAt:x=>x/10}));
  const handle=mountSectionHandle(document.querySelector('main'),()=>cut,change,vi.fn());
  try{
    const positive=document.querySelector('[data-transform-handle="positive"]'),negative=document.querySelector('[data-transform-handle="negative"]');
    expect(positive.style.getPropertyValue('--manipulator-angle')).toBe('90deg');expect(negative.style.getPropertyValue('--manipulator-angle')).toBe('270deg');
    positive.setPointerCapture=()=>{};positive.hasPointerCapture=()=>false;
    const pointer=(type,x)=>{const event=new dom.window.Event(type,{bubbles:true});for(const [name,value] of Object.entries({button:0,pointerId:1,clientX:x,clientY:100}))Object.defineProperty(event,name,{value});positive.dispatchEvent(event);};
    pointer('pointerdown',140);pointer('pointermove',160);expect(cut.offsetMillimeters).toBe(7);
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));expect(cut.offsetMillimeters).toBe(5);
    positive.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true}));expect(cut.offsetMillimeters).toBe(15);
    const field=document.querySelector('input');field.value='2.75';field.dispatchEvent(new dom.window.Event('input'));expect(cut.offsetMillimeters).toBe(2.75);
  }finally{handle.dispose();vi.unstubAllGlobals();dom.window.close();}
});

it('drags the projected ring across the angle seam, snaps, and restores the complete pivot on Escape', () => {
  const dom=new JSDOM('<body><main/></body>');
  for(const key of ['window','document','CustomEvent'])vi.stubGlobal(key,dom.window[key]);
  vi.stubGlobal('requestAnimationFrame',()=>0);vi.stubGlobal('cancelAnimationFrame',()=>{});
  const camera=new PerspectiveCamera(45,1,.1,1000);camera.position.set(60,-80,70);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
  let cut={id:'test',plane:{label:'Top',originMillimeters:[0,0,0],normal:[0,0,1]},offsetMillimeters:4,rotationDegrees:[170,20],pivotMillimeters:[2,3,4]};
  const before=structuredClone(cut);
  const projection=()=>projectSection(cut,camera,{left:0,top:0,width:700,height:700},new Box3());
  window.addEventListener('aether-section-handle',event=>event.detail.respond(projection()));
  const widget=mountSectionHandle(document.querySelector('main'),()=>cut,value=>{cut={...cut,offsetMillimeters:value};},vi.fn(),patch=>{cut={...cut,...patch};});
  try {
    const ring=projection().rotations[0],hit=document.querySelector('[data-transform-handle="rotate-0"]');
    hit.setPointerCapture=()=>{};hit.hasPointerCapture=()=>false;
    const pointer=(type,degrees,shiftKey=false)=>{
      const p=ring.orbit.pointAt(degrees),event=new dom.window.Event(type,{bubbles:true});
      for(const [name,value] of Object.entries({button:0,pointerId:1,clientX:p.x,clientY:p.y,shiftKey}))Object.defineProperty(event,name,{value});
      hit.dispatchEvent(event);
    };
    pointer('pointerdown',170);pointer('pointermove',190);
    expect(cut.rotationDegrees[0]).toBeCloseTo(190);expect(cut.rotationDegrees[1]).toBe(20);
    pointer('pointermove',197,true);expect(cut.rotationDegrees[0]).toBe(195);
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    expect(cut).toEqual(before);
    pointer('pointerdown',170);pointer('pointermove',150);pointer('pointerup',150);
    expect(cut.rotationDegrees[0]).toBeCloseTo(150);
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    expect(cut.rotationDegrees[0]).toBeCloseTo(150);
  } finally {widget.dispose();vi.unstubAllGlobals();dom.window.close();}
});
