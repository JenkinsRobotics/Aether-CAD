import {createRequire} from 'node:module';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {extrudeDepthDrag,mountExtrusionHandle} from './extrude-depth-drag';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
let dom;
beforeAll(()=>{dom=new JSDOM('<body></body>',{pretendToBeVisual:true});for(const k of ['window','document','Event','CustomEvent'])vi.stubGlobal(k,dom.window[k]);});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});
function control(value){const el=document.createElement('input');el.value=value;return el;}
function capture(button){button.setPointerCapture=vi.fn();button.hasPointerCapture=()=>false;}
function pointer(button,type,y,x=0){const event=new dom.window.MouseEvent(type,{clientY:y,clientX:x,button:0,bubbles:true});Object.defineProperty(event,'pointerId',{value:1});button.dispatchEvent(event);}
it('scrubs depth, crosses the sketch plane, and restores both depth and direction on Escape',()=>{
  const distance=control('10'),reverse=control('false'),input=vi.fn();distance.addEventListener('input',input);
  const button=extrudeDepthDrag(distance,reverse,'mm');document.body.append(button);capture(button);
  pointer(button,'pointerdown',100);pointer(button,'pointermove',50);
  expect(distance.value).toBe('15');expect(reverse.value).toBe('false');
  pointer(button,'pointermove',250);expect(distance.value).toBe('5');expect(reverse.value).toBe('true');
  button.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  expect(distance.value).toBe('10');expect(reverse.value).toBe('false');expect(input).toHaveBeenCalled();button.remove();
});
it('uses document display units for keyboard depth adjustments',()=>{
  const distance=control('1'),reverse=control('false');distance.dataset.canonicalFactor='25.4';
  const button=extrudeDepthDrag(distance,reverse,'in');
  button.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowUp',shiftKey:true}));
  expect(Number(distance.value)*25.4).toBeCloseTo(27.94);
});
it('maps the viewport handle through the viewer axis and cleans up when the editor closes',async()=>{
  document.body.innerHTML='<div class="cad-studio-viewport"><div id="panel"></div></div>';
  const panel=document.querySelector('#panel');
  const controls={distance:control('1'),reversed:control('false'),selections:control('[{"featureId":"sketch"}]'),endType:control('blind'),offset:control('0'),second:control('0')};
  controls.distance.dataset.canonicalFactor='25.4';
  const respond=event=>event.detail.respond({x:100,y:100,depthAt:(x,y)=>y});
  window.addEventListener('aether-extrusion-handle',respond);
  try{
    mountExtrusionHandle(panel,controls,'in');
    await vi.waitFor(()=>expect(document.querySelector('.cad-extrusion-handle')?.textContent).toBe('1 in'));
    const button=document.querySelector('.cad-extrusion-handle');capture(button);
    pointer(button,'pointerdown',100);pointer(button,'pointermove',125.4);pointer(button,'pointerup',125.4);
    expect(Number(controls.distance.value)).toBeCloseTo(2);
    panel.remove();await vi.waitFor(()=>expect(document.querySelector('.cad-extrusion-handle')).toBeNull());
  }finally{panel.remove();window.removeEventListener('aether-extrusion-handle',respond);}
});
it('supports signed face depth through the same drag handle and restores on cancellation',async()=>{
 document.body.innerHTML='<div class="cad-studio-viewport"><div id="face-panel"></div></div>';
 const panel=document.querySelector('#face-panel');const distance=control('5');distance.dataset.canonicalFactor='1';
 mountExtrusionHandle(panel,{distance},'mm',(_depth,respond)=>respond({x:100,y:100,depthAt:(_x,y)=>y}));
 await vi.waitFor(()=>expect(document.querySelector('.cad-extrusion-handle')?.textContent).toBe('5 mm'));
 const handle=document.querySelector('.cad-extrusion-handle');capture(handle);
 pointer(handle,'pointerdown',100);pointer(handle,'pointermove',90);
 expect(distance.value).toBe('-5');
 pointer(handle,'pointercancel',90);expect(distance.value).toBe('5');
 panel.remove();await vi.waitFor(()=>expect(document.querySelector('.cad-extrusion-handle')).toBeNull());
});

it('places and drags Remove into the sketch plane, including reversal and cancellation',async()=>{
 document.body.innerHTML='<div class="cad-studio-viewport"><div id="cut-panel"></div></div>';
 const panel=document.querySelector('#cut-panel');
 const controls={operation:control('cut'),distance:control('10'),reversed:control('false'),selections:control('[{"featureId":"sketch"}]'),endType:control('blind'),offset:control('0'),second:control('0')};
 const depths=[];
 const respond=event=>{depths.push(event.detail.depth);event.detail.respond({x:100,y:100,depthAt:(_x,y)=>y});};
 window.addEventListener('aether-extrusion-handle',respond);
 try {
  mountExtrusionHandle(panel,controls,'mm');
  await vi.waitFor(()=>expect(depths.at(-1)).toBe(-10));
  const handle=document.querySelector('.cad-extrusion-handle');capture(handle);
  pointer(handle,'pointerdown',100);pointer(handle,'pointermove',95);
  expect(controls.distance.value).toBe('15');expect(controls.reversed.value).toBe('false');
  pointer(handle,'pointermove',120);
  expect(controls.distance.value).toBe('10');expect(controls.reversed.value).toBe('true');
  handle.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  expect(controls.distance.value).toBe('10');expect(controls.reversed.value).toBe('false');
  controls.operation.value='add';await vi.waitFor(()=>expect(depths.at(-1)).toBe(10));
 } finally {panel.remove();window.removeEventListener('aether-extrusion-handle',respond);}
});

it('projects the handle along a normalized custom direction and hides it for invalid vectors',async()=>{
 document.body.innerHTML='<div class="cad-studio-viewport"><div id="direction-panel"></div></div>';
 const panel=document.querySelector('#direction-panel');const controls={distance:control('10'),reversed:control('false'),selections:control('[{"featureId":"sketch"}]'),endType:control('blind'),offset:control('0'),second:control('0'),directionMode:control('custom'),directionX:control('3'),directionY:control('0'),directionZ:control('4')};
 const vectors=[];const respond=event=>{vectors.push(event.detail.directionVector);event.detail.respond({x:100,y:100,depthAt:(_x,y)=>y});};window.addEventListener('aether-extrusion-handle',respond);
 try{mountExtrusionHandle(panel,controls,'mm');await vi.waitFor(()=>expect(vectors.at(-1)).toEqual([.6,0,.8]));
  const handle=document.querySelector('.cad-extrusion-handle');capture(handle);pointer(handle,'pointerdown',100);pointer(handle,'pointermove',105);pointer(handle,'pointerup',105);expect(controls.distance.value).toBe('15');
  controls.directionZ.value='0';controls.directionX.value='0';await vi.waitFor(()=>expect(handle.hidden).toBe(true));
 }finally{panel.remove();window.removeEventListener('aether-extrusion-handle',respond);}
});
it('updates the handle to the selected sketch line and hides it when the line is unavailable',async()=>{
 document.body.innerHTML='<div class="cad-studio-viewport"><div id="line-panel"></div></div>';
 const panel=document.querySelector('#line-panel');const controls={distance:control('10'),reversed:control('false'),selections:control('[{"featureId":"sketch"}]'),endType:control('blind'),offset:control('0'),second:control('0'),directionMode:control('line'),directionReferenceVector:control('[0.6,0,0.8]')};
 const vectors=[];const respond=event=>{vectors.push(event.detail.directionVector);event.detail.respond({x:100,y:100,depthAt:(_x,y)=>y});};window.addEventListener('aether-extrusion-handle',respond);
 try{mountExtrusionHandle(panel,controls,'mm');await vi.waitFor(()=>expect(vectors.at(-1)).toEqual([.6,0,.8]));
  controls.directionReferenceVector.value='[0.8,0,0.6]';await vi.waitFor(()=>expect(vectors.at(-1)).toEqual([.8,0,.6]));
  const handle=document.querySelector('.cad-extrusion-handle');capture(handle);pointer(handle,'pointerdown',100);pointer(handle,'pointermove',105);pointer(handle,'pointerup',105);expect(controls.distance.value).toBe('15');
  controls.directionReferenceVector.value='';await vi.waitFor(()=>expect(handle.hidden).toBe(true));
 }finally{panel.remove();window.removeEventListener('aether-extrusion-handle',respond);}
});
it('hides the sketch-origin handle for referenced starts and restores it after disabling the start',async()=>{
 document.body.innerHTML='<div class="cad-studio-viewport"><div id="start-panel"></div></div>';
 const panel=document.querySelector('#start-panel');const controls={distance:control('10'),reversed:control('false'),selections:control('[{"featureId":"sketch"}]'),endType:control('blind'),offset:control('2'),second:control('0'),startEnabled:control('true'),startMode:control('face')};
 const respond=event=>event.detail.respond({x:100,y:100,depthAt:(_x,y)=>y});window.addEventListener('aether-extrusion-handle',respond);
 try{mountExtrusionHandle(panel,controls,'mm');await vi.waitFor(()=>expect(document.querySelector('.cad-extrusion-handle').hidden).toBe(true));
  controls.startEnabled.value='false';await vi.waitFor(()=>expect(document.querySelector('.cad-extrusion-handle').hidden).toBe(false));
 }finally{panel.remove();window.removeEventListener('aether-extrusion-handle',respond);}
});
