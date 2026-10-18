import {createRequire} from 'node:module';
import {beforeAll,afterAll,afterEach,expect,it,vi} from 'vitest';
import {createEmptyPartDocument,parsePartDocument,serializePartDocument} from '@aether/core/document';
import {addSketchEllipseCenter,constrainSketchEllipse,sketchVariantContour,setSketchEllipseDiameter} from '@aether/core/sketch';
import {fixedEntityConstraint} from '../../freecad-engine/browser/fixed-geometry';
import {fullSketchEllipse} from '../../freecad-engine/browser/ellipse-manipulation';
import {pickSketchEditEntity} from './edit-picking';
import {clickSketchControl as click,querySketchControl as q} from './test-controls';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
let dom,open;
beforeAll(async()=>{
 dom=new JSDOM('<div class="cad-studio-viewport"></div>',{url:'http://localhost/cad/'});
 for(const key of ['window','document','HTMLElement','CustomEvent','Event','location'])vi.stubGlobal(key,dom.window[key]);
 open=(await import('../sketch-workspace')).openSketchWorkspace;
});
afterEach(()=>{if(q('.cad-sketch-workspace'))click('Cancel');});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});
function setup(change=d=>d) {
 let doc=createEmptyPartDocument('Ellipse handles');
 const drawing=change(addSketchEllipseCenter(constrainSketchEllipse({type:'drawing',contours:[sketchVariantContour('ellipse',[[0,0],[20,0],[0,10]])]},0),{contour:0,kind:'ellipse',index:0}));
 doc.features.push({id:'s',type:'profile',name:'Sketch 1',plane:'XY',offsetMillimeters:0,suppressed:false,profile:drawing});
 const apply=vi.fn(async next=>{doc=next;});open(()=>doc,apply,doc.features[0]);
 window.dispatchEvent(new CustomEvent('aether-sketch-tool',{detail:'select'}));
 const svg=q('.cad-sketch-workspace svg');
 svg.createSVGPoint=()=>({x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}});
 svg.getScreenCTM=()=>({inverse:()=>({})});
 const pointer=(type,x,y,options={})=>{
  const event=new dom.window.MouseEvent(type,{clientX:x,clientY:-y,button:0,bubbles:true,altKey:true,...options});
  Object.defineProperty(event,'pointerId',{value:1});svg.dispatchEvent(event);
 };
 const node=(kind,side=1)=>svg.querySelector(`[data-ellipse-handle="${kind}"][data-ellipse-side="${side}"]`);
 const point=(kind,side=1)=>[Number(node(kind,side).getAttribute('cx')),-Number(node(kind,side).getAttribute('cy'))].map(v=>v||0);
 const drag=(kind,target,side=1)=>{pointer('pointerdown',...point(kind,side));pointer('pointermove',...target);pointer('pointerup',...target);};
 return {svg,node,point,pointer,drag,apply,doc:()=>doc,before:structuredClone(drawing)};
}
it('exposes six derived handles and resizes the secondary diameter with one undo/redo and saved reopen',async()=>{
 const t=setup();expect(t.svg.querySelectorAll('[data-ellipse-handle]')).toHaveLength(6);
 expect(t.node('secondary').getAttribute('aria-label')).toContain('Resize ellipse secondary axis');
 t.drag('secondary',[4,18]);expect(t.point('secondary')).toEqual([0,18]);expect(t.point('primary')).toEqual([20,0]);expect(t.apply).not.toHaveBeenCalled();
 click('Undo');expect(t.point('secondary')).toEqual([0,10]);click('Redo');expect(t.point('secondary')).toEqual([0,18]);
 click('Finish sketch');await vi.waitFor(()=>expect(t.apply).toHaveBeenCalledOnce());
 const saved=parsePartDocument(serializePartDocument(t.doc())),drawing=saved.features[0].profile;
 expect(fullSketchEllipse(drawing,0)).toMatchObject({center:[0,0],radiusX:20,radiusY:18,rotation:0});
 expect(drawing.contours).toHaveLength(2);expect(drawing.constraints).toEqual(t.before.constraints);
 open(()=>saved,t.apply,saved.features[0]);expect(Number(q('[data-ellipse-handle="secondary"]').getAttribute('cy'))).toBe(-18);
});
it('rotates, resizes the rotated primary axis and saves exact half-arcs',async()=>{
 const t=setup(),radius=t.point('rotation')[0];t.drag('rotation',[0,radius]);
 expect(t.point('primary')[0]).toBeCloseTo(0,6);expect(t.point('primary')[1]).toBeCloseTo(20,6);
 t.drag('primary',[0,30]);expect(t.point('primary')[1]).toBeCloseTo(30,6);
 expect(t.point('secondary')[0]).toBeCloseTo(-10,6);
 click('Finish sketch');await vi.waitFor(()=>expect(t.apply).toHaveBeenCalledOnce());
 const shape=fullSketchEllipse(t.doc().features[0].profile,0);expect(shape.rotation).toBeCloseTo(Math.PI/2,8);expect(shape.radiusX).toBeCloseTo(30,8);expect(shape.radiusY).toBe(10);
});
it('cancels both an in-flight gesture and the whole sketch without saving geometry or extra construction',async()=>{
 const t=setup();t.pointer('pointerdown',...t.point('secondary'));t.pointer('pointermove',0,25);expect(t.point('secondary')).toEqual([0,25]);
 t.pointer('pointercancel',0,25);expect(t.point('secondary')).toEqual([0,10]);
 t.drag('primary',[35,0]);click('Cancel');expect(t.apply).not.toHaveBeenCalled();expect(t.doc().features[0].profile).toEqual(t.before);
});
it('keeps a driving diameter and a whole-entity Fix authoritative during pointer edits',async()=>{
 const t=setup(d=>{
  const sized=setSketchEllipseDiameter(d,{contour:0,kind:'ellipse',index:0},'x',40);
  sized.constraints.push(fixedEntityConstraint(sized,{contour:0,kind:'ellipse',index:0}));return sized;
 });
 expect(t.node('rotation').getAttribute('data-entity-constraint-state')).toBe('fully-constrained');
 t.drag('primary',[30,0]);expect(t.point('primary')).toEqual([20,0]);
 t.drag('rotation',[0,t.point('rotation')[0]]);expect(t.point('primary')).toEqual([20,0]);
 click('Finish sketch');await vi.waitFor(()=>expect(t.apply).toHaveBeenCalledOnce());expect(t.doc().features[0].profile).toEqual(t.before);
});
it('moves the real center node with ordinary snapping and keeps diameters steady',async()=>{
 const t=setup(d=>{d.contours.push({type:'path',start:[40,30],segments:[]});return d;});
 t.pointer('pointerdown',0,0,{altKey:false});t.pointer('pointermove',40.2,30.1,{altKey:false});t.pointer('pointerup',40.2,30.1,{altKey:false});
 t.point('center').forEach((v,i)=>expect(v).toBeCloseTo([40,30][i],5));
 click('Finish sketch');await vi.waitFor(()=>expect(t.apply).toHaveBeenCalledOnce());
 const drawing=t.doc().features[0].profile,shape=fullSketchEllipse(drawing,0);
 expect(shape.radiusX).toBe(20);expect(shape.radiusY).toBe(10);expect(drawing.constraints.some(c=>c.kind==='coincident' && [c.a.contour,c.b?.contour].includes(2))).toBe(true);
});
it('keeps an unrelated overlapping point selectable instead of stealing it with a handle',()=>{
 const t=setup(d=>{d.contours.unshift({type:'path',start:[0,10],segments:[]});for(const c of d.constraints){c.a.contour++;if(c.b)c.b.contour++;}return d;});
 const picked=pickSketchEditEntity(t.before,[0,10],t.svg);expect(picked.ref).toMatchObject({kind:'point',contour:0});expect(picked.ellipseHandle).toBeUndefined();
});
it('moves the full ellipse from its perimeter without deforming the other half',async()=>{
 const t=setup(),start=[20/Math.sqrt(2),10/Math.sqrt(2)],end=[start[0]+10,start[1]+15];
 t.pointer('pointerdown',...start);t.pointer('pointermove',...end);t.pointer('pointerup',...end);
 t.point('center').forEach((v,i)=>expect(v).toBeCloseTo([10,15][i],6));
 click('Finish sketch');await vi.waitFor(()=>expect(t.apply).toHaveBeenCalledOnce());
 expect(fullSketchEllipse(t.doc().features[0].profile,0)).toMatchObject({radiusX:20,radiusY:10,rotation:0});
});
