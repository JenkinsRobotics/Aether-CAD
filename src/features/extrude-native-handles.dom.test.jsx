import {createRequire} from 'node:module';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect,vi} from 'vitest';
import {mountNativeExtrusionHandles} from './extrude-native-handles';
const {JSDOM}=createRequire(import.meta.url)('jsdom');let dom,panel,controls,listener,requests;
const control=value=>{const e=document.createElement('input');e.value=value;return e;};
const axis=(side='primary',parameter='distance',scale=1)=>({side,parameter,scale,originMillimeters:[0,0,12],direction:[0,0,side==='primary'?1:-1],reversed:false});
const publish=(axes,pending=false,id='draft')=>panel.dispatchEvent(new CustomEvent('aether-feature-preview-state',{bubbles:true,detail:{pending,model:pending?undefined:axes?{featurePreview:{featureId:id,extrusionAxes:axes}}:null}}));
const pointer=(button,type,y)=>{const e=new dom.window.MouseEvent(type,{clientX:100,clientY:y,button:0,bubbles:true});Object.defineProperty(e,'pointerId',{value:1});button.dispatchEvent(e);};
const handle=label=>document.querySelector(`[aria-label="${label}"]`);
const capture=button=>{button.setPointerCapture=vi.fn();button.hasPointerCapture=()=>false;};
beforeAll(()=>{dom=new JSDOM('<body></body>',{pretendToBeVisual:true});for(const k of ['window','document','Event','CustomEvent'])vi.stubGlobal(k,dom.window[k]);});
beforeEach(()=>{
 document.body.innerHTML='<div class="cad-studio-viewport"><div id="panel" data-feature-id="draft"></div></div>';panel=document.querySelector('#panel');controls={distance:control('10'),second:control('3'),reversed:control('false')};requests=[];
 if(listener)window.removeEventListener('aether-native-extrusion-handle',listener);
 listener=e=>{requests.push(e.detail);e.detail.respond({x:100,y:100,depthAt:(_x,y)=>y});};window.addEventListener('aether-native-extrusion-handle',listener);
});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});
afterEach(async()=>{panel.remove();await vi.waitFor(()=>expect(document.querySelectorAll('.cad-extrusion-handle')).toHaveLength(0));});
it('uses the native shifted origin, pauses new drags while pending and clears failed or foreign results',async()=>{
 mountNativeExtrusionHandles(panel,controls,'mm');publish([axis()]);const button=handle('Pull extrusion depth');capture(button);
 await vi.waitFor(()=>expect(requests.at(-1)?.origin).toEqual([0,0,12]));expect(button.hidden).toBe(false);
 publish(undefined,true);await vi.waitFor(()=>expect(button.disabled).toBe(true));pointer(button,'pointerdown',100);pointer(button,'pointermove',110);expect(controls.distance.value).toBe('10');
 publish([axis()]);await vi.waitFor(()=>expect(button.disabled).toBe(false));pointer(button,'pointerdown',100);pointer(button,'pointermove',105);expect(controls.distance.value).toBe('15');
 publish(undefined,true);pointer(button,'pointermove',110);expect(controls.distance.value).toBe('20');
 button.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(controls.distance.value).toBe('10');
 publish([axis()],false,'another-feature');await vi.waitFor(()=>expect(button.hidden).toBe(true));
 publish([axis()]);await vi.waitFor(()=>expect(button.hidden).toBe(false));publish(null);await vi.waitFor(()=>expect(button.hidden).toBe(true));
 panel.remove();await vi.waitFor(()=>expect(document.querySelectorAll('.cad-extrusion-handle')).toHaveLength(0));
});
it('symmetric handles edit total depth at twice the axial travel',async()=>{
 mountNativeExtrusionHandles(panel,controls,'mm');publish([axis('primary','distance',.5),axis('opposite','distance',.5)]);
 const button=handle('Pull symmetric extrusion depth');capture(button);await vi.waitFor(()=>expect(button.hidden).toBe(false));expect(button.textContent).toBe('10 mm total');
 pointer(button,'pointerdown',100);pointer(button,'pointermove',105);pointer(button,'pointerup',105);expect(controls.distance.value).toBe('20');expect(controls.second.value).toBe('3');
});
it('the independent opposite handle adjusts only its positive distance in display units',async()=>{
 controls.second.value='1';controls.second.dataset.canonicalFactor='25.4';mountNativeExtrusionHandles(panel,controls,'in');publish([axis(),axis('opposite','second')]);
 const button=handle('Pull opposite extrusion depth');capture(button);await vi.waitFor(()=>expect(button.hidden).toBe(false));
 pointer(button,'pointerdown',100);pointer(button,'pointermove',125.4);pointer(button,'pointerup',125.4);expect(Number(controls.second.value)).toBeCloseTo(2);expect(controls.distance.value).toBe('10');expect(controls.reversed.value).toBe('false');
 button.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowUp',shiftKey:true,bubbles:true}));expect(Number(controls.second.value)).toBeCloseTo(2.1);
 pointer(button,'pointerdown',100);pointer(button,'pointermove',0);expect(Number(controls.second.value)).toBeGreaterThan(0);expect(controls.reversed.value).toBe('false');pointer(button,'pointercancel',0);expect(Number(controls.second.value)).toBeCloseTo(2.1);
});
it('reversed native axes preserve signed primary drag and Escape restores reversal',async()=>{
 controls.reversed.value='true';mountNativeExtrusionHandles(panel,controls,'mm');publish([{...axis(),direction:[0,0,-1],reversed:true}]);
 const button=handle('Pull extrusion depth');capture(button);await vi.waitFor(()=>expect(button.hidden).toBe(false));expect(requests.at(-1).direction).toEqual([-0,-0,1]);expect(requests.at(-1).depth).toBe(-10);
 pointer(button,'pointerdown',100);pointer(button,'pointermove',120);expect(controls.distance.value).toBe('10');expect(controls.reversed.value).toBe('false');button.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(controls.reversed.value).toBe('true');
});

it('preserves the simple Blind handle on older workers without guessing referenced starts',async()=>{
 Object.assign(controls,{selections:control('[{"featureId":"sketch"}]'),endType:control('blind'),offset:control('0'),startEnabled:control('false'),startMode:control('face'),secondEnabled:control('false')});
 const respond=e=>e.detail.respond({x:100,y:100,depthAt:(_x,y)=>y});window.addEventListener('aether-extrusion-handle',respond);
 try{
  mountNativeExtrusionHandles(panel,controls,'mm');panel.dispatchEvent(new CustomEvent('aether-feature-preview-state',{detail:{pending:false,model:{featurePreview:{base:[],added:[],removed:[]}}}}));
  const button=handle('Pull sketch extrusion depth');await vi.waitFor(()=>expect(button.hidden).toBe(false));controls.startEnabled.value='true';await vi.waitFor(()=>expect(button.hidden).toBe(true));
 }finally{window.removeEventListener('aether-extrusion-handle',respond);}
});

it('signed face offsets cross zero and Escape restores the previous signed value',async()=>{
 controls={distance:control('-1')};mountNativeExtrusionHandles(panel,controls,'mm',{signed:true,label:'Drag face offset'});publish([axis()]);
 const buttons=[...document.querySelectorAll('[aria-label="Drag face offset"]')];const button=buttons[0];capture(button);
 await vi.waitFor(()=>expect(button.hidden).toBe(false));expect(buttons.slice(1).every(e=>e.hidden)).toBe(true);
 pointer(button,'pointerdown',100);pointer(button,'pointermove',105);expect(Number(controls.distance.value)).toBe(4);
 button.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(Number(controls.distance.value)).toBe(-1);
 expect(document.querySelector('[aria-label="Pull sketch extrusion depth"]')).toBeNull();
});
