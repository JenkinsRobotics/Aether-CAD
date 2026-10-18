import {describe,expect,it} from 'vitest';
import {addSketchEllipseAxis,addSketchEllipseCenter,constrainSketchEllipse,sketchVariantContour,setSketchEllipseDiameter,type SketchDrawing} from '@aether/core/sketch';
import {fixedEntityConstraint} from '../../freecad-engine/browser/fixed-geometry';
import {dragSketchEllipse,ellipseHandles,fullSketchEllipse} from '../../freecad-engine/browser/ellipse-manipulation';

export function ellipseFixture():SketchDrawing {
  return addSketchEllipseCenter(constrainSketchEllipse({type:'drawing',contours:[sketchVariantContour('ellipse',[[0,0],[20,0],[0,10]])]},0),{contour:0,kind:'ellipse',index:0});
}
const handle=(d:SketchDrawing,kind:'center'|'primary'|'secondary'|'rotation',side:1|-1=1)=>ellipseHandles(d,6).find(h=>h.kind===kind && h.side===side)!;
const drag=(d:SketchDrawing,kind:Parameters<typeof handle>[1],to:[number,number],side:1|-1=1)=>{
 const h=handle(d,kind,side);return dragSketchEllipse(d,h,h.point,to);
};
describe('exact ellipse manipulation',()=>{
 it.each([['primary',1,[30,5],30,10],['primary',-1,[-30,7],30,10],['secondary',1,[7,15],20,15],['secondary',-1,[3,-15],20,15]] as const)('resizes %s side %s about its center without changing the other diameter',(kind,side,to,rx,ry)=>{
  const source=ellipseFixture(),before=structuredClone(source),next=drag(source,kind,[...to],side);
  expect(fullSketchEllipse(next,0)).toMatchObject({center:[0,0],radiusX:rx,radiusY:ry,rotation:0});
  expect(source).toEqual(before);expect(next.contours).toHaveLength(source.contours.length);expect(next.constraints).toEqual(source.constraints);
 });
 it('keeps primary and secondary identities when the second axis becomes the longer one',()=>{
  const next=drag(ellipseFixture(),'secondary',[0,30]);
  expect(fullSketchEllipse(next,0)).toMatchObject({radiusX:20,radiusY:30});
  expect(handle(next,'primary').point).toEqual([20,0]);expect(handle(next,'secondary').point).toEqual([0,30]);
 });
 it('rotates an ellipse about its center and then sizes along its rotated axes',()=>{
  const rotated=drag(ellipseFixture(),'rotation',[0,26]);
  expect(fullSketchEllipse(rotated,0)).toMatchObject({radiusX:20,radiusY:10,center:[0,0]});
  expect(fullSketchEllipse(rotated,0)!.rotation).toBeCloseTo(Math.PI/2,10);
  const sized=drag(rotated,'secondary',[-15,4]);
  expect(fullSketchEllipse(sized,0)!.radiusY).toBeCloseTo(15,8);expect(fullSketchEllipse(sized,0)!.radiusX).toBe(20);
 });
 it('translates the center and its real linked node while preserving both diameters and rotation',()=>{
  const source=ellipseFixture(),next=drag(source,'center',[7,9]);
  expect(fullSketchEllipse(next,0)).toMatchObject({center:[7,9],radiusX:20,radiusY:10,rotation:0});
  const center=next.contours[1];expect(center.type==='path' && center.start[0]).toBeCloseTo(7,6);expect(center.type==='path' && center.start[1]).toBeCloseTo(9,6);
  expect(next.constraints).toEqual(source.constraints);
 });
 it('respects driving diameters but still translates the sized ellipse',()=>{
  const source=setSketchEllipseDiameter(ellipseFixture(),{contour:0,kind:'ellipse',index:0},'x',40),before=structuredClone(source);
  expect(()=>drag(source,'primary',[30,0])).toThrow(/constraints/);
  expect(source).toEqual(before);
  expect(fullSketchEllipse(drag(source,'center',[5,6]),0)).toMatchObject({center:[5,6],radiusX:20,radiusY:10});
 });
 it('allows resizing about a fixed center, refuses rotation against an orientation constraint',()=>{
  let source=ellipseFixture();source.constraints!.push({id:'center-lock',kind:'fix',a:{contour:1,kind:'point',index:0},point:[0,0]});
  expect(fullSketchEllipse(drag(source,'primary',[30,0]),0)!.radiusX).toBe(30);
  expect(()=>drag(source,'center',[2,3])).toThrow(/constraints/);
  const axis=addSketchEllipseAxis(source,{contour:0,kind:'ellipse',index:0},'x');source=axis.drawing;
  source.constraints!.push({id:'axis-horizontal',kind:'horizontal',a:axis.axis});
  expect(()=>drag(source,'rotation',[0,26])).toThrow(/constraints/);
 });
 it('propagates a quadrant endpoint edit to attached geometry without replacing identities',()=>{
  const source=ellipseFixture();source.contours[0].id='ellipse';source.contours.push({id:'line',type:'path',start:[20,0],segments:[{type:'line',end:[50,10]}]});
  source.constraints!.push({id:'attached',kind:'coincident',a:{contour:0,kind:'point',index:0},b:{contour:2,kind:'point',index:0}});
  const next=drag(source,'primary',[30,0]),line=next.contours[2];
  expect(line.type==='path' && line.start[0]).toBeCloseTo(30,6);expect(next.contours.map(c=>c.id)).toEqual(source.contours.map(c=>c.id));
 });
 it.each(['center','primary','secondary','rotation'] as const)('refuses %s edits of a fixed ellipse atomically',kind=>{
  const source=ellipseFixture();source.constraints!.push(fixedEntityConstraint(source,{contour:0,kind:'ellipse',index:0}));
  const before=structuredClone(source);expect(()=>drag(source,kind,[30,30])).toThrow(/constraints/);expect(source).toEqual(before);
 });
 it('rejects collapse and invalid coordinates without changing the drawing',()=>{
  const source=ellipseFixture(),before=structuredClone(source);
  expect(()=>drag(source,'primary',[0,0])).toThrow(/positive/);expect(()=>drag(source,'rotation',[0,0])).toThrow(/away/);
  expect(()=>drag(source,'secondary',[0,NaN])).toThrow(/finite/);expect(source).toEqual(before);
 });
 it('does not invent full-ellipse handles for arbitrary open elliptical arcs',()=>{
  const source=ellipseFixture();source.constraints=[];
  expect(ellipseHandles(source,6)).toEqual([]);expect(()=>dragSketchEllipse(source,{contour:0,kind:'primary',side:1},[20,0],[30,0])).toThrow(/authored full ellipse/);
 });
});
