import fs from 'node:fs';
import {createRequire} from 'node:module';
import {beforeAll,beforeEach,afterEach,afterAll,expect,it,vi} from 'vitest';
import {parsePartDocument,serializePartDocument} from '@aether/core/document';
import cases from '../../service/tests/fixtures/pierce-documents.json';
import {clickSketchControl as click,querySketchControl as q} from './test-controls';
import {cadCommands} from '../cad-command-registry';
import {applyDocumentUnits} from '../document-preferences';
import {translateDocument} from '../freecad-translate';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
let dom,open,doc,apply,disposeCommand;const captures=[];
const command=()=>window.dispatchEvent(new CustomEvent('aether-sketch-constraint',{detail:'pierce'}));
beforeAll(async()=>{
 dom=new JSDOM('<!doctype html><body></body>',{url:'http://localhost/cad/'});
 for(const key of ['window','document','HTMLElement','CustomEvent','Event','location'])vi.stubGlobal(key,dom.window[key]);
 open=(await import('../sketch-workspace')).openSketchWorkspace;
 // This is the same dynamic event bridge installed by main.ts for every
 // declared constraint; the actual workspace shortcut/command path is tested.
 disposeCommand=cadCommands.register('sketch-constraint-pierce',command);
},30000);
beforeEach(()=>{
 document.body.innerHTML='<div class="cad-studio-viewport"></div>';applyDocumentUnits({});
 doc=structuredClone(cases.find(c=>c.name==='circle-center').document);
 doc.features[0].profile={type:'drawing',contours:[{type:'path',start:[0,-5],segments:[{type:'line',end:[20,5]}]}]};
 const d=doc.features[1].profile;d.constraints=d.constraints.filter(c=>c.kind!=='pierce');d.contours[0].center=[0,0];
 apply=vi.fn(async next=>{doc=next;});cadCommands.setEnabled('sketch-constraint-pierce',true);
});
afterEach(()=>{q('[aria-label="Cancel sketch"]')?.click();});
afterAll(()=>{disposeCommand();dom.window.close();vi.unstubAllGlobals();if(process.env.AETHER_PIERCE_UI_FIXTURES)fs.writeFileSync(process.env.AETHER_PIERCE_UI_FIXTURES,JSON.stringify(captures,null,2)+'\n');});
const target=()=>doc.features.find(f=>f.id==='target');
const field=name=>document.querySelector(`[aria-label="${name}"]`);
const change=(name,value)=>{const f=field(name);expect(f).toBeTruthy();f.value=value;f.dispatchEvent(new Event('change'));};
const selectTarget=predicate=>{const f=field('Pierce target'),option=[...f.options].find(o=>o.value&&predicate(JSON.parse(o.value)));expect(option).toBeTruthy();change('Pierce target',option.value);};
const center=()=>selectTarget(r=>r.kind==='point'&&r.index===0&&r.control===undefined);
const key=(key,extra={})=>field('2D sketch canvas').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra}));
const pick=(x,y)=>{const svg=field('2D sketch canvas');svg.createSVGPoint=()=>({x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}});svg.getScreenCTM=()=>({a:1,b:0,inverse:()=>({})});svg.dispatchEvent(new dom.window.MouseEvent('click',{clientX:x,clientY:-y,bubbles:true}));};
async function finish(name){click('Finish sketch');await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());doc=parsePartDocument(serializePartDocument(doc));if(name){const translated=translateDocument(doc);expect(translated.complete).toBe(true);captures.push({name,document:structuredClone(doc),features:translated.features});}}
const marked=()=>document.querySelectorAll('[data-constraint-mark="pierce"]').length;

it('creates from Shift+G and explicit fields, stages source IDs and saves through the shared editor',async()=>{
 const original=serializePartDocument(doc);open(()=>doc,apply,target());key('G',{shiftKey:true});
 expect(field('2D sketch canvas').dataset.constraintTool).toBe('pierce');
 expect(field('Pierce source curve').closest('.aui-feature-window')).toBeTruthy();center();
 expect(document.querySelectorAll('[data-pierce-contact]')).toHaveLength(1);click('Apply Pierce');
 expect(marked()).toBe(1);expect(serializePartDocument(doc)).toBe(original);expect(apply).not.toHaveBeenCalled();
 await finish('center');expect(target().profile.contours[0].center).toEqual([expect.closeTo(10,7),expect.closeTo(0,7)]);
 expect(doc.features[0].profile.contours[0].id).toBeTruthy();expect(doc.features[0].profile.contours[0].segments[0].id).toBeTruthy();
 expect(JSON.stringify(doc)).not.toMatch(/pierceContext|projectionContext/);
});
it('uses actual preselection and canvas contact picking, with one undo/redo transaction',async()=>{
 open(()=>doc,apply,target());pick(0,0);command();expect(field('Pierce target').value).not.toBe('');pick(10,0);expect(marked()).toBe(1);
 click('Undo');expect(marked()).toBe(0);click('Redo');expect(marked()).toBe(1);
 await finish('canvas-undo-redo');expect(target().profile.constraints.filter(c=>c.kind==='pierce')).toHaveLength(1);
});
it('undo restores source identities as well as the target constraint before saving',async()=>{
 const source=structuredClone(doc.features[0]);open(()=>doc,apply,target());command();center();click('Apply Pierce');click('Undo');
 await finish();expect(doc.features[0]).toEqual(source);expect(target().profile.constraints.map(c=>c.kind)).toEqual(['radius']);
});
it('cancels the entire source/target transaction and exits Pierce with Escape',()=>{
 const before=serializePartDocument(doc);open(()=>doc,apply,target());command();center();click('Apply Pierce');key('Escape');
 expect(field('2D sketch canvas').dataset.constraintTool).toBe('');expect(document.querySelectorAll('[data-pierce-contact]')).toHaveLength(0);
 click('Cancel sketch');expect(apply).not.toHaveBeenCalled();expect(serializePartDocument(doc)).toBe(before);
});
it('distinguishes a circle edge from its center and supports repeated tool-first pairs',async()=>{
 doc.features=doc.features.filter(f=>f.type==='profile');
 target().profile.contours.push({type:'circle',center:[0,10],radius:2});
 open(()=>doc,apply,target());command();pick(3,0);pick(10,0);expect(marked()).toBe(1);
 expect(field('2D sketch canvas').dataset.constraintTool).toBe('pierce');selectTarget(r=>r.kind==='point'&&r.contour===1);click('Apply Pierce');expect(marked()).toBe(2);
 await finish('repeated-edge-and-center');
 expect(target().profile.constraints.filter(c=>c.kind==='pierce').map(c=>c.a.kind)).toEqual(['circle','point']);
 expect(target().profile.contours[0].center[0]).toBeCloseTo(7,7);expect(target().profile.contours[1].center[0]).toBeCloseTo(10,7);
});
it('rejects a conflicting fixed center without adding source IDs or undo history',async()=>{
 target().profile.constraints.push({id:'fixed',kind:'fix',a:{contour:0,kind:'point',index:0},point:[0,0]});
 const source=structuredClone(doc.features[0]);open(()=>doc,apply,target());command();center();click('Apply Pierce');
 expect(marked()).toBe(0);expect(document.body.textContent).toMatch(/conflict|satisf|constraint/i);
 expect(cadCommands.snapshot()['sketch-undo'].enabled).toBe(false);key('Escape');await finish();expect(doc.features[0]).toEqual(source);
});
it('lets the user choose either exact circle-source intersection, with units and keyboard access',async()=>{
 doc.features[0].profile={type:'circle',centerMillimeters:[0,0],radiusMillimeters:5};
 open(()=>doc,apply,target());command();center();expect(field('Pierce intersection').options.length).toBe(3);
 expect(field('Pierce intersection').textContent).toContain('mm');
 const marker=[...document.querySelectorAll('[data-pierce-contact]')].find(n=>n.dataset.pierceContact==='1');marker.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 expect(marked()).toBe(1);await finish('circle-branch');expect(target().profile.contours[0].center[0]).toBeCloseTo(-5,7);
 expect(target().profile.constraints.find(c=>c.kind==='pierce').source.sourceSegmentId).toBeUndefined();
});
it('opens a broken source for repair, replaces it under the same constraint identity and undoes repair',async()=>{
 doc=structuredClone(cases.find(c=>c.name==='circle-center').document);doc.features[0].id='replacement';doc.features[0].profile.contours[0].segments[0].end=[40,5];
 const before=structuredClone(target().profile.constraints[1]);open(()=>doc,apply,target());expect(field('Finish sketch').disabled).toBe(true);
 cadCommands.execute('sketch-constraints');document.querySelector('[data-constraint-kind="pierce"] button').click();
 change('Pierce source curve',field('Pierce source curve').options[1].value);click('Apply Pierce');expect(field('Finish sketch').disabled).toBe(false);
 click('Undo');expect(field('Finish sketch').disabled).toBe(true);click('Redo');expect(field('Finish sketch').disabled).toBe(false);
 await finish('repaired');expect(target().profile.constraints[1].id).toBe(before.id);expect(target().profile.constraints[1].source.sourceFeatureId).toBe('replacement');
});
it('removes broken sources individually without silently dropping the remaining relationship',async()=>{
 doc=structuredClone(cases.find(c=>c.name==='circle-center').document);doc.features.shift();const relation=structuredClone(target().profile.constraints[1]);relation.id='missing-two';relation.source.sourceFeatureId='other-missing';target().profile.constraints.push(relation);
 open(()=>doc,apply,target());cadCommands.execute('sketch-constraints');
 const remove=()=>[...document.querySelector('[data-constraint-kind="pierce"]').querySelectorAll('button')].find(b=>b.textContent==='Remove').click();
 remove();expect(field('Finish sketch').disabled).toBe(true);expect(document.querySelectorAll('[data-constraint-kind="pierce"]')).toHaveLength(1);
 remove();expect(field('Finish sketch').disabled).toBe(false);await finish();expect(target().profile.constraints.map(c=>c.kind)).toEqual(['radius']);
});
it('does not add a redundant transaction when selecting the same target and source twice',async()=>{
 open(()=>doc,apply,target());command();center();click('Apply Pierce');center();click('Apply Pierce');
 expect(marked()).toBe(1);expect(document.body.textContent).toContain('already exists');click('Undo');expect(marked()).toBe(0);
 await finish();expect(target().profile.constraints.map(c=>c.kind)).toEqual(['radius']);expect(doc.features[0].profile.contours[0].id).toBeUndefined();
});
it('disambiguates overlapping source curves before authoring a relationship',async()=>{
 const second=structuredClone(doc.features[0]);second.id='other-source';second.name='Other source';doc.features.splice(1,0,second);
 open(()=>doc,apply,target());command();center();expect(field('Pierce source curve').value).toBe('');pick(10,0);
 expect(marked()).toBe(0);expect(document.body.textContent).toContain('overlap');
 const selected=[...field('Pierce source curve').options].find(x=>x.textContent.startsWith('Other source'));change('Pierce source curve',selected.value);click('Apply Pierce');
 await finish('overlap-choice');expect(target().profile.constraints.find(c=>c.kind==='pierce').source.sourceFeatureId).toBe('other-source');
});
it('changes an existing source branch under the same identity and preserves its dimensional constraints',async()=>{
 doc=structuredClone(cases.find(c=>c.name==='circle-source-0').document);open(()=>doc,apply,target());cadCommands.execute('sketch-constraints');
 const id=target().profile.constraints.find(c=>c.kind==='pierce').id;
 document.querySelector('[data-constraint-kind="pierce"] button').click();change('Pierce intersection','1');click('Apply Pierce');
 await finish('replace-branch');expect(target().profile.constraints.find(c=>c.kind==='pierce').id).toBe(id);
 expect(target().profile.contours[0]).toMatchObject({center:[expect.closeTo(-5,7),expect.closeTo(0,7)],radius:3});
});
it('shows contact coordinates in document units while saving millimeter geometry',async()=>{
 applyDocumentUnits({length:{unit:'in',decimals:4}});open(()=>doc,apply,target());command();center();
 expect(field('Pierce intersection').textContent).toContain('0.39370079');expect(field('Pierce intersection').textContent).toContain('in');
 click('Apply Pierce');await finish('inch-display');expect(target().profile.contours[0].center[0]).toBeCloseTo(10,7);
});
it('authors a spline control target without replacing the curve by a point',async()=>{
 doc=structuredClone(cases.find(c=>c.name==='cubic-control').document);target().profile.constraints=[];
 open(()=>doc,apply,target());command();selectTarget(r=>r.control===0);click('Apply Pierce');await finish('spline-control');
 expect(target().profile.contours).toHaveLength(1);expect(target().profile.contours[0].segments[0].type).toBe('bezier');
 expect(target().profile.constraints[0].a).toMatchObject({kind:'point',control:0});
});
it('retains projection context when authoring a Pierce on an authored mixed-sketch curve',async()=>{
 doc=structuredClone(cases.find(c=>c.name==='mixed-projection').document);target().profile.authored.constraints=target().profile.authored.constraints.filter(c=>c.kind!=='pierce');target().profile.authored.contours[0].center=[0,0];
 open(()=>doc,apply,target());command();center();click('Apply Pierce');await finish('mixed');
 expect(target().profile.type).toBe('projection');expect(target().profile.authored.constraints.find(c=>c.kind==='pierce')).toBeTruthy();
 expect(JSON.stringify(doc)).not.toMatch(/pierceContext|projectionContext/);
});

it('picks a Pierce contact through the same in-world sketch surface after it is reparented',async()=>{
 const layer=document.createElement('div');document.body.append(layer);const ended=vi.fn();
 const onSurface=e=>{layer.append(e.detail.svg);e.detail.connect({toSketch:(x,y)=>[(x-100)/2,(200-y)/2],scaleAt:()=>.5,updateBounds(){}});};
 window.addEventListener('aether-sketch-surface',onSurface);window.addEventListener('aether-sketch-surface-end',ended);
 try {
  open(()=>doc,apply,target());command();center();expect(document.querySelector('.cad-sketch-workspace.in-world')).toBeTruthy();
  const svg=field('2D sketch canvas');expect(svg.parentElement).toBe(layer);
  svg.dispatchEvent(new dom.window.MouseEvent('click',{clientX:120,clientY:200,bubbles:true}));
  expect(marked()).toBe(1);await finish();expect(target().profile.contours[0].center[0]).toBeCloseTo(10,7);expect(ended).toHaveBeenCalledOnce();
 }finally{window.removeEventListener('aether-sketch-surface',onSurface);window.removeEventListener('aether-sketch-surface-end',ended);layer.remove();}
});

it('repairs a missing Pierce source without forcing reattachment of an independent valid support face',async()=>{
 doc=structuredClone(cases.find(c=>c.name==='circle-center').document);doc.features[0].id='replacement';
 const sketch=target();sketch.support={sourceFeatureId:'support-pad',bodyId:'support-body',normal:[0,-1,0],xDirection:[1,0,0],label:'Face of Base'};
 sketch.frame={originMillimeters:[0,0,0],normal:[0,-1,0],xDirection:[1,0,0]};
 doc.features.splice(1,0,
  {id:'base',name:'Base sketch',type:'profile',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'circle',centerMillimeters:[0,0],radiusMillimeters:50}},
  {id:'support-pad',name:'Base',type:'extrude',profileFeatureId:'base',bodyId:'support-body',suppressed:false,operation:'new',distanceMillimeters:5});
 const support=structuredClone(sketch.support);open(()=>doc,apply,sketch);expect(field('Finish sketch').disabled).toBe(true);
 cadCommands.execute('sketch-constraints');document.querySelector('[data-constraint-kind="pierce"] button').click();
 change('Pierce source curve',field('Pierce source curve').options[1].value);click('Apply Pierce');
 expect(field('Finish sketch').disabled).toBe(false);await finish();expect(target().support).toEqual(support);
});
