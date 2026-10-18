import {createRequire} from 'node:module';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {createEmptyPartDocument,insertFeature,parsePartDocument,serializePartDocument} from '@aether/core/document';
import {recordFeatureErrors} from '../modeling/feature-errors';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
let dom,open,doc,apply;
const frame=z=>({originMillimeters:[2.5,10,z],normal:[0,0,1],xDirection:[1,0,0]});
const support=z=>({sourceFeatureId:'base',bodyId:'body',normal:[0,0,1],xDirection:[1,0,0],label:'Face of Base',faceAnchor:{centerMillimeters:[2.5,10,z],areaSquareMillimeters:100}});
const drawing={type:'drawing',contours:[{id:'bore',type:'circle',center:[0,0],radius:1}],constraints:[{id:'size',kind:'radius',a:{kind:'circle',contour:0},value:1},{id:'center',kind:'fix',a:{kind:'point',contour:0,index:0},point:[0,0]}]};
const click=label=>(document.querySelector(`[aria-label="${label}"]`)??[...document.querySelectorAll('button')].find(b=>b.textContent===label))?.click();
const changePlane=()=>document.querySelector('.aui-feature-entity button').click();
const finish=()=>document.querySelector('[aria-label="Finish sketch"]');
const face=z=>window.dispatchEvent(new CustomEvent('aether-sketch-face',{detail:{frame:frame(z),support:support(z)}}));
beforeAll(async()=>{
 dom=new JSDOM('<html><body></body></html>',{url:'http://localhost/cad/'});
 for(const key of ['window','document','HTMLElement','CustomEvent','Event','location'])vi.stubGlobal(key,dom.window[key]);
 open=(await import('../sketch-workspace')).openSketchWorkspace;
});
beforeEach(()=>{
 document.body.innerHTML='<div class="cad-studio-viewport"></div>';
 doc=createEmptyPartDocument('Support repair');
 doc=insertFeature(doc,{id:'base-profile',type:'profile',name:'Base sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',centerMillimeters:[0,0],radiusMillimeters:10}});
 doc=insertFeature(doc,{id:'base',type:'extrude',name:'Base',profileFeatureId:'base-profile',distanceMillimeters:15,operation:'new',bodyId:'body',suppressed:false});
 doc=insertFeature(doc,{id:'attached',type:'profile',name:'Bore sketch',plane:'XY',offsetMillimeters:0,frame:frame(15),support:support(15),profile:structuredClone(drawing),suppressed:false});
 doc=insertFeature(doc,{id:'cut',type:'extrude',name:'Cut',profileFeatureId:'attached',operation:'cut',targetBodyId:'body',distanceMillimeters:2,suppressed:false});
 doc.sketchPresentation={attached:{dimensionLabelPositionsMillimeters:{size:[3,4]}}};
 apply=vi.fn(async next=>{doc=next;});
});
afterEach(()=>{click('Cancel sketch');});
afterAll(async()=>{document.body.replaceChildren();await Promise.resolve();dom.window.close();vi.unstubAllGlobals();});

it('repairs a failed support without changing contour/constraint IDs, dimensions or downstream features',async()=>{
 const before=structuredClone(doc);
 recordFeatureErrors(doc,new Map([['attached','Sketch support face changed or is ambiguous. Reselect the face.']]));
 open(()=>doc,apply,doc.features[2]);
 expect(finish().disabled).toBe(true);expect(document.body.textContent).toContain('Sketch support face changed');
 changePlane();
 expect(document.querySelector('.choosing-plane')).not.toBeNull();expect(finish().disabled).toBe(true);
 expect(document.querySelector('[aria-label="2D sketch canvas"]').style.visibility).toBe('hidden');
 const complete=vi.fn();window.dispatchEvent(new CustomEvent('aether-sketch-finish',{detail:{complete},cancelable:true}));
 await vi.waitFor(()=>expect(complete).toHaveBeenCalledWith(false));expect(apply).not.toHaveBeenCalled();
 window.dispatchEvent(new CustomEvent('aether-sketch-face',{detail:{error:'Choose an earlier planar face.'}}));
 expect(finish().disabled).toBe(true);
 face(17);expect(finish().disabled).toBe(false);expect(doc).toEqual(before);
 click('Finish sketch');await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 const saved=parsePartDocument(serializePartDocument(doc));
 expect(saved.features[2]).toMatchObject({id:'attached',frame:frame(17),support:support(17),profile:drawing});
 expect(saved.features[3]).toEqual(before.features[3]);
 expect(saved.sketchPresentation).toEqual(before.sketchPresentation);
});

it('cancels a changed attachment and keeps the original saved document byte-for-byte',()=>{
 const before=serializePartDocument(doc);
 open(()=>doc,apply,doc.features[2]);changePlane();face(21);click('Cancel sketch');
 expect(apply).not.toHaveBeenCalled();expect(serializePartDocument(doc)).toBe(before);
 open(()=>doc,apply,doc.features[2]);expect(document.body.textContent).toContain('Face of Base');
 expect(finish().disabled).toBe(false);
});

it('retains an offset sketch on reopen and resets its offset when choosing a principal plane',async()=>{
 delete doc.features[2].frame;delete doc.features[2].support;doc.features[2].offsetMillimeters=9;
 const frames=[];const listen=e=>frames.push(e.detail.frame);window.addEventListener('aether-sketch-surface',listen);
 try{
  open(()=>doc,apply,doc.features[2]);expect(frames.at(-1).originMillimeters).toEqual([0,0,9]);
  changePlane();window.dispatchEvent(new CustomEvent('aether-sketch-plane',{detail:'YZ'}));
  expect(frames.at(-1).originMillimeters).toEqual([0,0,0]);
  click('Finish sketch');await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
  expect(doc.features[2]).toMatchObject({plane:'YZ',offsetMillimeters:0,profile:drawing});
  expect(doc.features[2].support).toBeUndefined();expect(doc.features[2].frame).toBeUndefined();
 }finally{window.removeEventListener('aether-sketch-surface',listen);}
});

it('detaches a supported sketch to a datum plane and prevents support changes during commit',async()=>{
 let resolve;apply=vi.fn(()=>new Promise(r=>{resolve=r;}));
 open(()=>doc,apply,doc.features[2]);changePlane();window.dispatchEvent(new CustomEvent('aether-sketch-plane',{detail:'XZ'}));
 click('Finish sketch');await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 expect(document.querySelector('.aui-feature-entity button').disabled).toBe(true);
 document.querySelector('.aui-feature-entity button').click();
 expect(document.querySelector('.choosing-plane')).toBeNull();
 const saved=apply.mock.calls[0][0].features[2];expect(saved.support).toBeUndefined();expect(saved.frame).toBeUndefined();expect(saved.profile).toEqual(drawing);
 resolve();await vi.waitFor(()=>expect(document.querySelector('.cad-sketch-workspace')).toBeNull());
});

it('does not force a plane change for unrelated sketch geometry errors',()=>{
 recordFeatureErrors(doc,new Map([['attached','Invalid circle radius.']]));
 open(()=>doc,apply,doc.features[2]);expect(finish().disabled).toBe(false);
});
