import {it,expect} from 'vitest';
import {dragSketchEntity} from './drag-entity';
import type {SketchDrawing} from '../drawing';
it('drags a vertex or edge without persisting temporary constraints',()=>{
 const d:SketchDrawing={type:'drawing',contours:[{type:'path',start:[0,0],segments:[{type:'line',end:[10,0]}]}]};
 const moved=dragSketchEntity(d,{contour:0,kind:'line',index:0},[2,3]),path=moved.contours[0];if(path.type!=='path')throw Error();expect(path.start).toEqual([2,3]);expect(path.segments[0].end).toEqual([12,3]);expect(moved.constraints).toBeUndefined();expect(d.contours[0]).not.toEqual(path);
});
it('a drag conflicting with a fixed point leaves the point where it is, without mutating the drawing',()=>{
 const d:SketchDrawing={type:'drawing',contours:[{type:'path',start:[0,0],segments:[]}],constraints:[{id:'fixed',kind:'fix',a:{contour:0,kind:'point',index:0},point:[0,0]}]},before=structuredClone(d);
 const moved=dragSketchEntity(d,{contour:0,kind:'point',index:0},[2,3]);
 expect(moved.contours[0].type==='path'&&moved.contours[0].start).toEqual([0,0]);expect(d).toEqual(before);
});
it('a drag that the constraints cannot honour moves as far as allowed and never throws',()=>{
 // The line's start is fixed at the origin: dragging the whole line can only rotate/stretch within the fix.
 const d:SketchDrawing={type:'drawing',contours:[{type:'path',start:[0,0],segments:[{type:'line',end:[10,0]}]}],
  constraints:[{id:'fx',kind:'fix',a:{contour:0,kind:'point',index:0},point:[0,0]}]};
 const moved=dragSketchEntity(d,{contour:0,kind:'line',index:0},[5,5]);
 const path=moved.contours[0];if(path.type!=='path')throw Error();
 expect(path.start).toEqual([0,0]);
 expect(moved.constraints?.map(c=>c.id)).toEqual(['fx']);
});
it('a free end of a horizontal line dragged diagonally follows the pointer along the line',()=>{
 const d:SketchDrawing={type:'drawing',contours:[{type:'path',start:[0,0],segments:[{type:'line',end:[10,0]}]}],constraints:[{id:'fixed',kind:'fix',a:{contour:0,kind:'point',index:0},point:[0,0]},{id:'h',kind:'horizontal',a:{contour:0,kind:'line',index:0}}]};
 const moved=dragSketchEntity(d,{contour:0,kind:'point',index:1},[5,4]),path=moved.contours[0];if(path.type!=='path')throw Error();
 expect(path.segments[0].end[0]).toBeCloseTo(15);expect(path.segments[0].end[1]).toBeCloseTo(0);
});

