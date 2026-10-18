import {createRequire} from 'node:module';
import {beforeAll,beforeEach,afterEach,afterAll,expect,it,vi} from 'vitest';
import {parsePartDocument,serializePartDocument} from '@aether/core/document';
import cases from '../../service/tests/fixtures/pierce-documents.json';
import {clickSketchControl,querySketchControl} from './test-controls';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
let dom,open,doc,apply;
beforeAll(async()=>{
 dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/cad/index.html'});
 for(const key of ['window','document','HTMLElement','CustomEvent','Event','location'])vi.stubGlobal(key,dom.window[key]);
 open=(await import('../sketch-workspace')).openSketchWorkspace;
});
beforeEach(()=>{
 document.body.innerHTML='<div class="cad-studio-viewport"></div>';
 doc=structuredClone(cases.find(c=>c.name==='circle-center').document);
 apply=vi.fn(async next=>{doc=next;});
});
afterEach(()=>{querySketchControl('[aria-label="Cancel sketch"]')?.click();});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});
const target=()=>doc.features.find(f=>f.id==='target');
const finish=()=>querySketchControl('[aria-label="Finish sketch"]');
const changePlane=()=>querySketchControl('button[title="Change sketch plane"]').click();

it('opens the resolved saved relationship and finishes through the standard editor without storing context',async()=>{
 doc.features[0].profile.contours[0].segments[0].end=[40,5];
 open(()=>doc,apply,target());
 expect(finish().disabled).toBe(false);
 clickSketchControl('Finish sketch');await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 const saved=parsePartDocument(serializePartDocument(doc)),drawing=saved.features.find(f=>f.id==='target').profile;
 expect(drawing.contours[0]).toMatchObject({center:[expect.closeTo(20,7),expect.closeTo(0,7)],radius:3});
 expect(drawing.constraints.map(c=>c.kind)).toEqual(['radius','pierce']);
 expect(JSON.stringify(saved)).not.toMatch(/pierceContext|projectionContext/);
});
it('recomputes the source intersection when choosing a different plane',async()=>{
 open(()=>doc,apply,target());changePlane();
 const frame={originMillimeters:[0,2,0],normal:[0,-1,0],xDirection:[1,0,0]};
 window.dispatchEvent(new CustomEvent('aether-sketch-face',{detail:{frame,label:'Offset plane'}}));
 expect(finish().disabled).toBe(false);
 clickSketchControl('Finish sketch');await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 expect(target().frame).toEqual(frame);
 expect(target().profile.contours[0]).toMatchObject({center:[expect.closeTo(14,7),expect.closeTo(0,7)]});
 expect(target().profile.constraints[1].source.sourceFeatureId).toBe('source');
});
it('keeps plane selection active when a source becomes coplanar and permits cancellation without changes',()=>{
 const before=serializePartDocument(doc);open(()=>doc,apply,target());changePlane();
 window.dispatchEvent(new CustomEvent('aether-sketch-plane',{detail:'XY'}));
 expect(finish().disabled).toBe(true);expect(querySketchControl('.choosing-plane')).not.toBeNull();
 expect(document.body.textContent).toMatch(/coplanar|intersection|Pierce/);
 clickSketchControl('Cancel sketch');expect(apply).not.toHaveBeenCalled();expect(serializePartDocument(doc)).toBe(before);
});
