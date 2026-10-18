import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import { bindSketchBoxSelection, sketchEntitiesInBox } from './box-selection';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const drawing = { type: 'drawing', contours: [
  {type:'path', start:[0,0], segments:[{type:'line',end:[20,0]}]},
  {type:'circle',center:[40,20],radius:5},
  {type:'path', start:[25,40], segments:[{type:'arc',middle:[30,45],end:[35,40]}]},
] };
let dom;
afterEach(()=>{dom?.window.close();vi.unstubAllGlobals();});
it('window encloses complete edges while crossing selects intersecting geometry',()=>{
  const rect = {left:8,right:12,top:-2,bottom:2};
  expect(sketchEntitiesInBox(drawing,p=>p,rect,'window')).toEqual([]);
  expect(sketchEntitiesInBox(drawing,p=>p,rect,'crossing')).toMatchObject([{contour:0,kind:'line'}]);
  expect(sketchEntitiesInBox(drawing,p=>p,{left:-1,right:46,top:-1,bottom:26},'window')).toHaveLength(2);
});
it('crossing tests curves themselves instead of selecting empty space inside their bounds',()=>{
  expect(sketchEntitiesInBox(drawing,p=>p,{left:39,right:41,top:19,bottom:21},'crossing')).toMatchObject([{kind:'point',contour:1}]);
  expect(sketchEntitiesInBox(drawing,p=>p,{left:44,right:46,top:19,bottom:21},'crossing')).toMatchObject([{kind:'circle'}]);
  expect(sketchEntitiesInBox(drawing,p=>p,{left:29,right:31,top:44,bottom:46},'crossing')).toMatchObject([{kind:'arc'}]);
});
it('uses projected screen positions for rotated sketch planes',()=>{
  const project=([x,y])=>[100-y,100+x];
  expect(sketchEntitiesInBox(drawing,project,{left:98,right:102,top:99,bottom:121},'window')).toMatchObject([{contour:0}]);
});
it('previews a box, commits once on release, adds with Shift and cancels without selection',()=>{
  dom = new JSDOM('<svg></svg>');vi.stubGlobal('document',dom.window.document);
  const svg=document.querySelector('svg'), select=vi.fn();
  const binding=bindSketchBoxSelection({svg,enabled:()=>true,drawing:()=>drawing,point:e=>[e.clientX,e.clientY],project:p=>p,tolerance:()=>.1,select});
  const pointer=(type,x,y,options={})=>{const e=new dom.window.MouseEvent(type,{clientX:x,clientY:y,button:0,bubbles:true,...options});Object.defineProperty(e,'pointerId',{value:1});svg.dispatchEvent(e);};
  pointer('pointerdown',-2,-2);pointer('pointermove',46,26);
  expect(document.querySelector('.cad-sketch-selection-box').dataset.mode).toBe('window');expect(select).not.toHaveBeenCalled();
  pointer('pointerup',46,26,{shiftKey:true});expect(select).toHaveBeenCalledOnce();expect(select.mock.calls[0][0]).toHaveLength(2);expect(select.mock.calls[0][1]).toBe(true);expect(binding.consumeClick()).toBe(true);
  pointer('pointerdown',-2,-2);pointer('pointermove',46,26);pointer('pointercancel',46,26);
  expect(select).toHaveBeenCalledOnce();expect(document.querySelector('.cad-sketch-selection-box')).toBeNull();binding.dispose();
});

it('a window around a vertex selects that point without requiring the full edge',()=>{
  expect(sketchEntitiesInBox(drawing,p=>p,{left:-1,right:1,top:-1,bottom:1},'window')).toMatchObject([{kind:'point',contour:0,index:0}]);
});
