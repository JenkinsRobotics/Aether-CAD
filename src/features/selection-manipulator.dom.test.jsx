import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect,vi} from 'vitest';
import {availableBodies,parsePartDocument} from '@aether/core/document';
import {mountSelectionManipulator} from './selection-manipulator';
import {cadSelection} from '../cad-selection-store';
const {JSDOM}=createRequire(import.meta.url)('jsdom');let dom,source,initial,viewer,apply,dispose,editable,viewport;
const fixture=parsePartDocument(readFileSync(new URL('../../service/tests/fixtures/automation-part.acpart',import.meta.url),'utf8'));
beforeAll(()=>{dom=new JSDOM('<body/>',{pretendToBeVisual:true});for(const key of ['window','document','Event','CustomEvent','HTMLCanvasElement'])vi.stubGlobal(key,dom.window[key]);vi.stubGlobal('requestAnimationFrame',dom.window.requestAnimationFrame.bind(dom.window));vi.stubGlobal('cancelAnimationFrame',dom.window.cancelAnimationFrame.bind(dom.window));});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});
beforeEach(()=>{
 document.body.innerHTML='<main><canvas/></main>';viewport=document.querySelector('main');source=structuredClone(fixture);initial=source;editable=true;
 const id=availableBodies(source)[0].id;cadSelection.dispatch({type:'replace',items:[{id:`body:${id}`,partId:id,kind:'body',label:'Part'}]});
 viewer={manipulatorFrame:()=>({centerMillimeters:[5,10,2.5],radiusMillimeters:10}),clearManipulatorPreview:vi.fn(),clearInteractionAnchors:vi.fn(),previewManipulatorTransform:vi.fn(),pickManipulatorPivot:()=>({point:[10,20,5]}),projectSelectionManipulator:pivot=>[
  {id:'moveX',kind:'axis',label:'Move X',x:100,y:100,axis:[1,0,0],sample:x=>[x,0,0]},
  {id:'rotateZ',kind:'rotation',label:'Rotate Z',x:150,y:150,axis:[0,0,1],sample:x=>x},
  {id:'pivot',kind:'pivot',label:'Pivot',x:pivot[0],y:pivot[1],sample:()=>null},
 ]};
 apply=vi.fn(async candidate=>{source=candidate;});dispose=mountSelectionManipulator({viewport,viewer,document:()=>source,editable:()=>editable,apply,status:vi.fn()});
});
afterEach(()=>{dispose();cadSelection.dispatch({type:'clear'});document.body.innerHTML='';});
const button=async id=>{await vi.waitFor(()=>expect(document.querySelector(`[data-transform-handle="${id}"]`)?.hidden).toBe(false));const b=document.querySelector(`[data-transform-handle="${id}"]`);b.setPointerCapture=vi.fn();b.hasPointerCapture=()=>false;return b;};
const pointer=(b,type,x,shiftKey=false)=>{const e=new dom.window.MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:0,shiftKey});Object.defineProperty(e,'pointerId',{value:1});b.dispatchEvent(e);};
it('previews a drag and commits exactly one ordinary transform on release',async()=>{
 const b=await button('moveX');pointer(b,'pointerdown',100);pointer(b,'pointermove',110);pointer(b,'pointermove',120,true);expect(apply).not.toHaveBeenCalled();expect(viewer.previewManipulatorTransform.mock.calls.at(-1)[1].translationMillimeters).toEqual([11,0,0]);pointer(b,'pointerup',120);
 await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(1));expect(source.features).toHaveLength(initial.features.length+1);expect(source.features.at(-1).transform.translationMillimeters).toEqual([11,0,0]);expect(initial.features).toHaveLength(fixture.features.length);
});
it.each(['escape','blur','selection','readonly','document'])('cancels without history when %s interrupts a drag',async reason=>{
 const b=await button('moveX');pointer(b,'pointerdown',100);pointer(b,'pointermove',120);
 if(reason==='escape')window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape'}));if(reason==='blur')window.dispatchEvent(new Event('blur'));if(reason==='selection')cadSelection.dispatch({type:'clear'});if(reason==='readonly')editable=false;if(reason==='document')source=structuredClone(source);
 await vi.waitFor(()=>expect(document.body.dataset.cadHandleDrag).toBeUndefined());pointer(b,'pointerup',120);expect(apply).not.toHaveBeenCalled();expect(viewer.clearManipulatorPreview).toHaveBeenCalled();
});
it('moves the pivot without a document write and uses it for the next rotation',async()=>{
 const p=await button('pivot');pointer(p,'pointerdown',0);pointer(p,'pointermove',10);pointer(p,'pointerup',10);expect(apply).not.toHaveBeenCalled();
 const b=await button('rotateZ');pointer(b,'pointerdown',170);pointer(b,'pointermove',-170);pointer(b,'pointerup',-170);await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(1));expect(source.features.at(-1).transform).toEqual({kind:'rotate',axisOriginMillimeters:[10,20,5],axisDirection:[0,0,1],angleDegrees:20});
});
it('creates new stable body IDs for Copy and preserves the original body',async()=>{
 const b=await button('moveX');document.querySelector('.aui-manipulator-copy').click();pointer(b,'pointerdown',100);pointer(b,'pointermove',110);pointer(b,'pointerup',110);await vi.waitFor(()=>expect(availableBodies(source)).toHaveLength(2));const mapping=source.features.at(-1).copyBodyIds;expect(Object.keys(mapping)).toEqual([availableBodies(initial)[0].id]);expect(cadSelection.snapshot().items[0].partId).toBe(Object.values(mapping)[0]);
});
it('restores the preview on an evaluator failure and leaves the document unchanged',async()=>{
 apply.mockRejectedValue(new Error('Native transform failed'));const b=await button('moveX');pointer(b,'pointerdown',100);pointer(b,'pointermove',110);pointer(b,'pointerup',110);await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(1));expect(source).toBe(initial);expect(viewer.clearManipulatorPreview).toHaveBeenCalled();
});
