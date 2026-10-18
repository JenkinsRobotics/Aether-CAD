import { createRequire } from 'node:module';
import { beforeAll, beforeEach, afterAll, afterEach, expect, it, vi } from 'vitest';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument } from '@aether/core/document';
import { fitSketchSpline, constrainFitSpline } from '@aether/core/sketch';
import { translateDocument } from '../freecad-translate';
import { clickSketchControl as click, querySketchControl as q } from './test-controls';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom, open, commands, doc, apply;
beforeAll(async () => {
  dom = new JSDOM('<div class="cad-studio-viewport"></div>', {url:'http://localhost/cad/'});
  for (const key of ['window','document','HTMLElement','CustomEvent','Event','location','crypto']) vi.stubGlobal(key,dom.window[key]);
  open = (await import('../sketch-workspace')).openSketchWorkspace;
  commands = (await import('../cad-command-registry')).cadCommands;
  (await import('../feature-authoring')).mountFeatureAuthoring(()=>doc,next=>apply(next));
});
beforeEach(() => {
  document.body.innerHTML='<div class="cad-studio-viewport"></div>';
  doc=createEmptyPartDocument('Connected spline workflow');
  const drawing=constrainFitSpline({type:'drawing',contours:[fitSketchSpline([[20,20],[60,70],[110,20]])]},0);
  drawing.contours.push({type:'path',start:[110,20],segments:[{type:'line',end:[20,20]}]});
  doc.features.push({id:'s',type:'profile',name:'Sketch 1',plane:'XY',offsetMillimeters:0,suppressed:false,profile:drawing});
  apply=vi.fn(async next=>{doc=next;});
});
afterEach(async () => {
  if(q('.cad-sketch-workspace')) click('Cancel');
  for(const cancel of document.querySelectorAll('[aria-label="Cancel"]'))cancel.click();
  await new Promise(resolve=>setTimeout(resolve,0));
});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});
function sketch() {
  open(()=>doc,next=>apply(next),doc.features[0]);
  window.dispatchEvent(new CustomEvent('aether-sketch-tool',{detail:'select'}));
  const svg=q('.cad-sketch-workspace svg');
  svg.createSVGPoint=()=>({x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}});
  svg.getScreenCTM=()=>({inverse:()=>({})});
  const pointer=(type,x,y)=>{
    const event=new dom.window.MouseEvent(type,{clientX:x,clientY:-y,button:0,bubbles:true,altKey:true});
    Object.defineProperty(event,'pointerId',{value:1}); svg.dispatchEvent(event);
  };
  return {svg,pointer};
}
async function finishToExtrude() {
  click('Finish sketch'); await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
  commands.execute('feature-extrude');
  await vi.waitFor(()=>expect(document.querySelector('[aria-label="Selected profiles"]')?.value).toBe('[{"featureId":"s","contourIndex":0}]'));
  return document.querySelector('.cad-feature-dialog');
}
it('fills and picks a spline closed by a separate line, then saves an exact joined Extrude', async () => {
  const {svg,pointer}=sketch();
  expect(svg.querySelectorAll('.derived-region')).toHaveLength(1);
  pointer('pointerdown',60,40);pointer('pointerup',60,40);pointer('click',60,40);
  expect(svg.querySelector('.derived-region').classList.contains('sketch-region-selected')).toBe(true);
  const panel=await finishToExtrude();
  expect(panel.querySelectorAll('.aui-feature-entity')).toHaveLength(1);
  panel.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(2));
  const reopened=parsePartDocument(serializePartDocument(doc));
  expect(reopened.features[0].profile.contours).toHaveLength(2);
  expect(reopened.features[0].profile.constraints.filter(c=>c.kind==='spline-shape')).toHaveLength(1);
  expect(reopened.features[1].profileRegion.contourIds).toHaveLength(2);
  expect(translateDocument(reopened).complete).toBe(true);
  expect(translateDocument(reopened).features.map(f=>f.kind)).toEqual(['sketch-wire','sketch-wire','sketch-region','pad']);
});
it('automatically hands over the joined face without an interior click, and Cancel saves no feature IDs', async () => {
  sketch(); const panel=await finishToExtrude(), before=structuredClone(doc);
  panel.querySelector('[aria-label="Cancel"]').click();
  expect(doc).toEqual(before);expect(doc.features).toHaveLength(1);
  expect(doc.features[0].profile.contours.every(c=>!c.id)).toBe(true);
});
it('uses the ordinary undo/redo cycle when deleting a selected joined boundary', async () => {
  const {svg,pointer}=sketch();
  pointer('pointerdown',60,40);pointer('pointerup',60,40);pointer('click',60,40);
  svg.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Delete',bubbles:true}));
  // Delete is routed through the shared sketch selection actions, so both
  // original contours are one user edit; source entities are never flattened.
  expect(svg.querySelectorAll('.derived-region')).toHaveLength(0);
  click('Undo');expect(svg.querySelectorAll('.derived-region')).toHaveLength(1);
  click('Redo');expect(svg.querySelectorAll('.derived-region')).toHaveLength(0);
  click('Undo');click('Finish sketch');await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
  expect(doc.features[0].profile.contours).toHaveLength(2);
});
