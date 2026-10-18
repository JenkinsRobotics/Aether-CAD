import { createRequire } from 'node:module';
import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument } from '@aether/core/document';
import { fitSketchSpline, constrainFitSpline } from '@aether/core/sketch';
import { clickSketchControl as click, querySketchControl as q } from './test-controls';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom, open;
beforeAll(async()=>{
  dom=new JSDOM('<div class="cad-studio-viewport"></div>',{url:'http://localhost/cad/'});
  for(const key of ['window','document','HTMLElement','CustomEvent','Event','location']) vi.stubGlobal(key,dom.window[key]);
  open=(await import('../sketch-workspace')).openSketchWorkspace;
});
afterEach(()=>{if(q('.cad-sketch-workspace'))click('Cancel');});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});
const points=[[20,20],[60,70],[110,30]];
function setup() {
  let doc=createEmptyPartDocument('Spline end handles');
  doc.features.push({id:'s',type:'profile',name:'Sketch 1',plane:'XY',offsetMillimeters:0,suppressed:false,
    profile:constrainFitSpline({type:'drawing',contours:[fitSketchSpline(points)]},0)});
  const apply=vi.fn(async next=>{doc=next;});
  open(()=>doc,apply,doc.features[0]);
  window.dispatchEvent(new CustomEvent('aether-sketch-tool',{detail:'select'}));
  const svg=q('.cad-sketch-workspace svg');
  svg.createSVGPoint=()=>({x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}});
  svg.getScreenCTM=()=>({inverse:()=>({})});
  const pointer=(name,x,y)=>{
    const event=new dom.window.MouseEvent(name,{clientX:x,clientY:-y,button:0,bubbles:true,altKey:true});
    Object.defineProperty(event,'pointerId',{value:1});svg.dispatchEvent(event);
  };
  const control=()=>q('[aria-label^="Spline 1, span 1, start tangent handle:"]');
  const position=()=>[Number(control().getAttribute('cx')),-Number(control().getAttribute('cy'))];
  return {svg,pointer,position,apply,document:()=>doc};
}
it('edits an end handle through the actual workspace, with one undo/redo and saved reopen',async()=>{
  const t=setup(), before=t.position(), target=[before[0]+8,before[1]+14];
  t.pointer('pointerdown',...before);t.pointer('pointermove',...target);t.pointer('pointerup',...target);
  t.position().forEach((v,i)=>expect(v).toBeCloseTo(target[i],5));
  click('Undo');t.position().forEach((v,i)=>expect(v).toBeCloseTo(before[i],5));
  click('Redo');t.position().forEach((v,i)=>expect(v).toBeCloseTo(target[i],5));
  click('Finish sketch');await vi.waitFor(()=>expect(t.apply).toHaveBeenCalledOnce());
  const saved=parsePartDocument(serializePartDocument(t.document())),drawing=saved.features[0].profile,path=drawing.contours[0];
  [path.start,...path.segments.map(s=>s.end)].forEach((p,i)=>p.forEach((v,k)=>expect(v).toBeCloseTo(points[i][k],5)));
  expect(drawing.constraints.filter(c=>c.kind==='spline-shape')).toMatchObject([{splineFreeEnds:['start']}]);
  expect(drawing.constraints.some(c=>c.id.startsWith('spline-drag-knot-')||c.id.startsWith('drag-target-'))).toBe(false);
  open(()=>saved,t.apply,saved.features[0]);
  expect(Number(q('[aria-label^="Spline 1, span 1, start tangent handle:"]').getAttribute('cx'))).toBeCloseTo(target[0],5);
});
it('cancels a handle gesture without persisting its independent-end activation',async()=>{
  const t=setup(), before=t.position();
  t.pointer('pointerdown',...before);t.pointer('pointermove',before[0]+10,before[1]+15);
  t.pointer('pointercancel',before[0]+10,before[1]+15);
  t.position().forEach((v,i)=>expect(v).toBeCloseTo(before[i],5));
  click('Finish sketch');await vi.waitFor(()=>expect(t.apply).toHaveBeenCalledOnce());
  expect(t.document().features[0].profile.constraints[0].splineFreeEnds).toBeUndefined();
});
