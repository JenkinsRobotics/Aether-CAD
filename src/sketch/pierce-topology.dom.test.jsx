import fs from 'node:fs';
import {createRequire} from 'node:module';
import {beforeAll,beforeEach,afterEach,afterAll,expect,it,vi} from 'vitest';
import {parsePartDocument,serializePartDocument,resolveProfileDrawing} from '@aether/core/document';
import {segmentPoint} from '../../aether-engine/src/sketch/curves/parameterization';
import {translateDocument} from '../freecad-translate';
import cases from '../../service/tests/fixtures/pierce-documents.json';
import {clickSketchControl as click,querySketchControl as q} from './test-controls';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
let dom,open,doc,apply;const captures=[];
beforeAll(async()=>{
 dom=new JSDOM('<!doctype html><body></body>',{url:'http://localhost/cad/'});
 for(const key of ['window','document','HTMLElement','CustomEvent','Event','location'])vi.stubGlobal(key,dom.window[key]);
 open=(await import('../sketch-workspace')).openSketchWorkspace;
},30000);
beforeEach(()=>{
 document.body.innerHTML='<div class="cad-studio-viewport"></div>';
 doc=structuredClone(cases.find(c=>c.name==='circle-center').document);
 const source=doc.features[0];source.frame={originMillimeters:[0,0,-3],normal:[0,0,1],xDirection:[1,0,0]};
 source.profile.contours[0].start=[0,-5];source.profile.contours[0].segments[0].end=[0,5];
 target().profile.contours[0].center=[0,0];target().profile.constraints.find(c=>c.kind==='pierce').a={kind:'circle',contour:0};
 apply=vi.fn(async next=>{doc=next;});
});
afterEach(()=>q('[aria-label="Cancel sketch"]')?.click());
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();if(process.env.AETHER_PIERCE_TOPOLOGY_UI_FIXTURES)fs.writeFileSync(process.env.AETHER_PIERCE_TOPOLOGY_UI_FIXTURES,JSON.stringify(captures,null,2)+'\n');});
const target=()=>doc.features.find(f=>f.id==='target');
const tool=name=>window.dispatchEvent(new CustomEvent('aether-sketch-tool',{detail:name}));
function point(x,y){q('[aria-label="X (mm)"]').value=String(x);q('[aria-label="Y (mm)"]').value=String(y);click('Place point');}
function pick(x,y){const svg=document.querySelector('[aria-label="2D sketch canvas"]');svg.createSVGPoint=()=>({x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}});svg.getScreenCTM=()=>({a:1,b:0,inverse:()=>({})});svg.dispatchEvent(new dom.window.MouseEvent('click',{clientX:x,clientY:-y,bubbles:true}));}
const marked=()=>document.querySelectorAll('[data-constraint-mark="pierce"]').length;
async function finish(name){click('Finish sketch');await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());doc=parsePartDocument(serializePartDocument(doc));if(name){const result=translateDocument(doc);expect(result.complete).toBe(true);captures.push({name,document:structuredClone(doc),features:result.features});}}
it('splits a constrained circle through the real controls and preserves the actual lower-arc contact on reopen',async()=>{
 open(()=>doc,apply,target());tool('split');point(3,0);point(-3,0);expect(marked()).toBe(1);
 click('Undo');expect(document.querySelector('circle.sketch-contour')).toBeTruthy();click('Redo');
 await finish('circle-split');expect(target().profile.contours[0].segments).toHaveLength(2);
 expect(target().profile.constraints.find(c=>c.kind==='pierce').a).toMatchObject({kind:'curve',index:1,sliding:true});
 const before=serializePartDocument(doc);open(()=>doc,apply,target());expect(marked()).toBe(1);click('Cancel sketch');expect(serializePartDocument(doc)).toBe(before);
});
it.each([true,false])('trims a circle with correct contact retention (%s), ordinary undo/redo and saved controls',async keep=>{
 doc.features=doc.features.filter(f=>f.type==='profile');doc.features[0].frame.originMillimeters[2]=keep?-3:3;
 target().profile.contours.push({type:'path',construction:true,start:[-5,0],segments:[{type:'line',end:[5,0]}]});
 open(()=>doc,apply,target());tool('trim');pick(0,3);expect(marked()).toBe(keep?1:0);
 if(!keep)expect(document.body.textContent).toContain('Trim removed 1 constraint');
 click('Undo');expect(marked()).toBe(1);click('Redo');expect(marked()).toBe(keep?1:0);
 await finish(`circle-trim-${keep}`);expect(target().profile.constraints.filter(c=>c.kind==='pierce')).toHaveLength(keep?1:0);
});
it('retains a constrained cubic control after split and keeps cancellation atomic',async()=>{
 doc=structuredClone(cases.find(c=>c.name==='cubic-control').document);const old=serializePartDocument(doc);
 const drawing=resolveProfileDrawing(doc.features,'target'),path=drawing.contours[0],at=segmentPoint(path.start,path.segments[0],.4);
 open(()=>doc,apply,target());tool('split');point(...at);expect(marked()).toBe(1);click('Cancel sketch');expect(serializePartDocument(doc)).toBe(old);
 open(()=>doc,apply,target());tool('split');point(...at);await finish('control-split');
 expect(target().profile.contours[0].segments).toHaveLength(2);expect(target().profile.constraints.find(c=>c.kind==='pierce').a.controlScale).toBeCloseTo(2.5,6);
});
