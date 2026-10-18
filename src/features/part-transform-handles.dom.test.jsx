import{createRequire}from'node:module';
import{beforeAll,afterAll,beforeEach,afterEach,it,expect,vi}from'vitest';
import{mountTransformHandles}from'./part-transform-handles';
const{JSDOM}=createRequire(import.meta.url)('jsdom');let dom,panel,c,listener,requests;
const field=value=>{const e=document.createElement('input');e.value=value;return e;};
const frame={centerMillimeters:[5,10,2.5],radiusMillimeters:15};
const publish=(pending=false,featureId='draft',value=frame)=>panel.dispatchEvent(new CustomEvent('aether-feature-preview-state',{detail:{pending,model:pending?undefined:{featurePreview:{featureId,transformFrame:value}}}}));
const pointer=(button,type,y,shiftKey=false)=>{const e=new dom.window.MouseEvent(type,{clientX:100,clientY:y,button:0,bubbles:true,shiftKey});Object.defineProperty(e,'pointerId',{value:1});button.dispatchEvent(e);};
const get=key=>document.querySelector(`[data-transform-handle="${key}"]`);
const wait=async key=>{const b=get(key);b.setPointerCapture=vi.fn();b.hasPointerCapture=()=>false;await vi.waitFor(()=>expect(b.hidden).toBe(false));return b;};
beforeAll(()=>{dom=new JSDOM('<body/>',{pretendToBeVisual:true});for(const k of['window','document','Event','CustomEvent'])vi.stubGlobal(k,dom.window[k]);});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});
beforeEach(()=>{
 document.body.innerHTML='<div class="cad-studio-viewport"><div id="panel" data-feature-id="draft"></div></div>';panel=document.querySelector('#panel');requests=[];
 c={mode:field('translate'),uniform:field('yes'),bodies:field('["body"]'),angle:field('0')};
 for(const prefix of['move','axis','origin','center','scale'])for(const axis of['X','Y','Z'])c[prefix+axis]=field(prefix==='scale'||prefix==='axis'&&axis==='Z'?'1':'0');
 listener=e=>{requests.push(e.detail);const keys=e.detail.transform.kind==='translate'?(e.detail.translationAxis?['distance']:['moveX','moveY','moveZ']):e.detail.transform.kind==='rotate'?['angle']:e.detail.uniform?['scaleX']:['scaleX','scaleY','scaleZ'];e.detail.respond(keys.map(key=>({key,label:key,color:'#123456',x:100,y:100,points:[{x:10,y:10},{x:100,y:100}],valueAt:(_x,y)=>y,...(key==='angle'?{cyclic:360}:{})})));};window.addEventListener('aether-transform-handles',listener);
});
afterEach(async()=>{panel.remove();await vi.waitFor(()=>expect(document.querySelector('.cad-transform-handles')).toBeNull());window.removeEventListener('aether-transform-handles',listener);});
it('requires a current native frame and prevents starting a drag while a preview is pending',async()=>{
 mountTransformHandles(panel,c,'mm','deg');await new Promise(r=>setTimeout(r,25));expect(requests).toEqual([]);
 publish();const b=await wait('moveX');expect(requests.at(-1).frame).toEqual(frame);
 publish(true);await vi.waitFor(()=>expect(b.disabled).toBe(true));pointer(b,'pointerdown',100);pointer(b,'pointermove',110);expect(c.moveX.value).toBe('0');
 publish(false,'another');await vi.waitFor(()=>expect(b.hidden).toBe(true));publish();await wait('moveX');publish(false,'draft',undefined); // undefined defaults to frame in this fixture
 panel.dispatchEvent(new CustomEvent('aether-feature-preview-state',{detail:{pending:false,model:null}}));await vi.waitFor(()=>expect(b.hidden).toBe(true));
});
it('moves in canonical millimeters, supports fine dragging and restores the original value with Escape',async()=>{
 c.moveX.value='1';c.moveX.dataset.canonicalFactor='25.4';mountTransformHandles(panel,c,'in','deg');publish();const b=await wait('moveX');
 pointer(b,'pointerdown',100);pointer(b,'pointermove',125.4);expect(Number(c.moveX.value)).toBeCloseTo(2);
 publish(true);pointer(b,'pointermove',150.8,true);expect(Number(c.moveX.value)).toBeCloseTo(2.1);expect(c.moveY.value).toBe('0');
 b.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(c.moveX.value).toBe('1');
 publish();await vi.waitFor(()=>expect(b.disabled).toBe(false));b.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true}));expect(Number(c.moveX.value)).toBeCloseTo(1.1);
});
it('rotates continuously through the angle seam and converts degrees to display radians',async()=>{
 c.mode.value='rotate';c.angle.value=String(170*Math.PI/180);c.angle.dataset.canonicalFactor=String(180/Math.PI);mountTransformHandles(panel,c,'mm','rad');publish();const b=await wait('angle');
 pointer(b,'pointerdown',170);pointer(b,'pointermove',-170);expect(Number(c.angle.value)*180/Math.PI).toBeCloseTo(190,5);pointer(b,'pointermove',-10);pointer(b,'pointerup',-10);expect(Number(c.angle.value)*180/Math.PI).toBeCloseTo(350,5);
 b.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));expect(Number(c.angle.value)*180/Math.PI).toBeCloseTo(365,5);
 pointer(b,'pointerdown',5);pointer(b,'pointermove',40);pointer(b,'pointercancel',40);expect(Number(c.angle.value)*180/Math.PI).toBeCloseTo(365,5);
});
it('keeps scale positive, edits only the selected factor and restores after lost capture',async()=>{
 c.mode.value='scale';c.uniform.value='no';mountTransformHandles(panel,c,'mm','deg');publish();const b=await wait('scaleY');
 pointer(b,'pointerdown',1);pointer(b,'pointermove',-20);expect(Number(c.scaleY.value)).toBe(1e-6);expect(c.scaleX.value).toBe('1');
 b.dispatchEvent(new dom.window.Event('lostpointercapture'));expect(c.scaleY.value).toBe('1');
 b.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',shiftKey:true,bubbles:true}));expect(Number(c.scaleY.value)).toBeCloseTo(.99);
});
it('cancels a drag on mode changes and removes controls and listeners when the dialog closes',async()=>{
 mountTransformHandles(panel,c,'mm','deg');publish();const b=await wait('moveZ');pointer(b,'pointerdown',100);pointer(b,'pointermove',110);expect(c.moveZ.value).toBe('10');
 c.mode.value='copy';c.mode.dispatchEvent(new Event('change'));expect(c.moveZ.value).toBe('0');await vi.waitFor(()=>expect(b.hidden).toBe(true));
 c.mode.value='translate';publish();await wait('moveZ');pointer(b,'pointerdown',100);pointer(b,'pointermove',110);panel.remove();await vi.waitFor(()=>expect(document.querySelector('.cad-transform-handles')).toBeNull());expect(c.moveZ.value).toBe('0');const count=requests.length;publish();await new Promise(r=>setTimeout(r,40));expect(requests.length).toBe(count);
});
it.each(['translate-reference','rotate-reference','scale-reference'])('drags %s only from a resolved native reference frame',async mode=>{
 c.mode.value=mode;c.distance=field('1');c.distance.dataset.canonicalFactor='25.4';c.useDistance=field('yes');
 mountTransformHandles(panel,c,'in','deg');publish();await new Promise(r=>setTimeout(r,40));expect(requests).toHaveLength(0);
 const resolved=mode==='translate-reference'?{kind:'translate',translationMillimeters:[15.24,20.32,0]}:mode==='rotate-reference'?{kind:'rotate',axisOriginMillimeters:[12,13,14],axisDirection:[0,.6,.8],angleDegrees:0}:{kind:'scale',centerMillimeters:[12,13,14],scaleFactors:[1,1,1]};
 publish(false,'draft',{...frame,resolvedTransform:resolved,referenceDirection:[.6,.8,0]});const key=mode==='translate-reference'?'distance':mode==='rotate-reference'?'angle':'scaleX',b=await wait(key);
 if(mode==='translate-reference')expect(requests.at(-1).transform.translationMillimeters).toEqual(resolved.translationMillimeters.map(n=>expect.closeTo(n,10)));else expect(requests.at(-1).transform).toEqual(resolved);pointer(b,'pointerdown',100);pointer(b,'pointermove',125.4,true);
 expect(Number(c[key].value)).toBeCloseTo(mode==='translate-reference'?1.1:mode==='rotate-reference'?2.54:3.54,5);
 b.dispatchEvent(new dom.window.Event('lostpointercapture'));expect(Number(c[key].value)).toBe(mode==='rotate-reference'?0:1);
 if(mode==='translate-reference'){c.useDistance.value='no';c.useDistance.dispatchEvent(new Event('change'));await vi.waitFor(()=>expect(b.hidden).toBe(true));}
});
