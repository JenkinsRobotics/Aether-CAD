import {createRequire} from 'node:module';
import {afterEach,expect,it,vi} from 'vitest';
import {PerspectiveCamera} from 'three';
import {createCADCameraControls} from './camera-controls';
import {bindSketchCameraInput} from './sketch-surface-input';
import {bindViewportContextGesture} from './context-menu-gesture';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
let dom,controls,unbind,unsketch;
afterEach(()=>{unbind?.();unsketch?.();controls?.dispose();dom?.window.close();vi.unstubAllGlobals();});
function setup(){
 dom=new JSDOM('<section id="viewport"><canvas class="viewport-canvas"></canvas><svg class="cad-sketch-canvas"><path/></svg><input></section><button id="outside">Feature</button>');
 vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document);
 dom.window.PointerEvent=class extends dom.window.MouseEvent{constructor(type,init={}){super(type,init);this.pointerId=init.pointerId??1;this.pointerType='mouse';}};
 const viewport=document.querySelector('#viewport'),canvas=viewport.querySelector('canvas');
 canvas.getBoundingClientRect=()=>({left:0,top:0,width:800,height:600});canvas.setPointerCapture=vi.fn();canvas.releasePointerCapture=vi.fn();
 const camera=new PerspectiveCamera(42,800/600,.1,10000);camera.position.set(0,-100,0);camera.up.set(0,0,1);
 controls=createCADCameraControls(camera,canvas,()=>{});
 // Match the shared application's document capture, which runs before canvas handlers.
 const menu=vi.fn();document.addEventListener('contextmenu',menu,true);
 unbind=bindViewportContextGesture(viewport);
 unsketch=bindSketchCameraInput(viewport.querySelector('svg'),canvas);
 const pointer=(type,x=400,y=300,target=canvas,button=2)=>{
  target.dispatchEvent(new dom.window.PointerEvent(type,{clientX:x,clientY:y,button,buttons:type==='pointerup'?0:2,bubbles:true,cancelable:true}));controls.update();
 };
 const context=(target=canvas,button=2)=>{const e=new dom.window.MouseEvent('contextmenu',{button,clientX:400,clientY:300,bubbles:true,cancelable:true});target.dispatchEvent(e);return e;};
 return {canvas,camera,menu,pointer,context};
}
it.each(['canvas','path'])('rotates over %s without letting a press-time or release-time menu steal the gesture',selector=>{
 const t=setup(),target=document.querySelector(selector),start=t.camera.position.clone();
 t.pointer('pointerdown',400,300,target);expect(t.context(target).defaultPrevented).toBe(true);
 expect(t.menu).not.toHaveBeenCalled();
 t.pointer('pointermove',450,330,target);t.pointer('pointerup',450,330,target);t.context(target);
 expect(t.camera.position.distanceTo(start)).toBeGreaterThan(1);expect(t.menu).not.toHaveBeenCalled();
 // A subsequent stationary click still opens the menu.
 t.pointer('pointerdown',400,300,target);t.pointer('pointerup',400,300,target);t.context(target);
 expect(t.menu).toHaveBeenCalledOnce();
});
it.each(['canvas','path'])('defers a stationary press-time menu over %s until release and opens it once',selector=>{
 const t=setup(),target=document.querySelector(selector);
 t.pointer('pointerdown',400,300,target);t.context(target);expect(t.menu).not.toHaveBeenCalled();
 t.pointer('pointermove',402,301,target);t.pointer('pointerup',402,301,target);
 expect(t.menu).toHaveBeenCalledOnce();t.context(target);expect(t.menu).toHaveBeenCalledOnce();
});
it('remembers a drag that returns to its starting point and movement delivered only at release',()=>{
 const t=setup();
 t.pointer('pointerdown');t.pointer('pointermove',450,300);t.pointer('pointerup');t.context();expect(t.menu).not.toHaveBeenCalled();
 t.pointer('pointerdown');t.pointer('pointerup',450,300);t.context();expect(t.menu).not.toHaveBeenCalled();
});
it.each(['pointercancel','lostpointercapture','blur'])('cancels a pending menu on %s and permits the next click',type=>{
 const t=setup();t.pointer('pointerdown');t.context();
 if(type==='blur')window.dispatchEvent(new dom.window.Event('blur'));else t.pointer(type);
 t.pointer('pointerup');t.context();expect(t.menu).not.toHaveBeenCalled();
 t.pointer('pointerdown');t.pointer('pointerup');t.context();expect(t.menu).toHaveBeenCalledOnce();
});
it('preserves keyboard, input and feature menus and removes all listeners on disposal',()=>{
 const t=setup();t.pointer('pointerdown');t.pointer('pointermove',450,330);t.pointer('pointerup',450,330);t.context();
 t.context(t.canvas,0);t.context(document.querySelector('input'));t.context(document.querySelector('#outside'));
 expect(t.menu).toHaveBeenCalledTimes(3);
 unbind();t.context();expect(t.menu).toHaveBeenCalledTimes(4);
});
it('routes accepted clicks to the viewport menu before the shared application capture',()=>{
 const t=setup(),open=vi.fn();unbind();unbind=bindViewportContextGesture(document.querySelector('#viewport'),open);
 t.pointer('pointerdown');t.context();expect(open).not.toHaveBeenCalled();
 t.pointer('pointerup');expect(open).toHaveBeenCalledOnce();expect(t.menu).not.toHaveBeenCalled();
 t.context();expect(open).toHaveBeenCalledOnce();
 t.pointer('pointerdown');t.pointer('pointermove',450,300);t.pointer('pointerup',450,300);t.context();expect(open).toHaveBeenCalledOnce();
 t.context(t.canvas,0);expect(open).toHaveBeenCalledTimes(2);
});
