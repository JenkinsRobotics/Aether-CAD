import { expect,it } from 'vitest';
import {sketchVariantContour} from './primitives';
import {validateSketchDrawing} from './drawing';
it('creates a midpoint line symmetrically and rotated rectangles with perpendicular edges',()=>{
 const line=sketchVariantContour('midpoint-line',[[3,4],[8,6]]);
 expect(line).toEqual({type:'path',start:[-2,2],segments:[{type:'line',end:[8,6]}]});
 const c=sketchVariantContour('aligned-rectangle',[[1,2],[4,6],[0,5]]);
 if(c.type!=='path')throw Error('path');
 const b=c.segments[0].end,d=c.segments[1].end;
 expect((b[0]-c.start[0])*(d[0]-b[0])+(b[1]-c.start[1])*(d[1]-b[1])).toBeCloseTo(0,10);
 validateSketchDrawing({type:'drawing',contours:[c]});
});
it('fits a circle through all three points and rejects collinear input',()=>{
 const c=sketchVariantContour('three-point-circle',[[15,7],[10,12],[5,7]]);
 expect(c).toEqual({type:'circle',center:[10,7],radius:5});
 expect(()=>sketchVariantContour('three-point-circle',[[0,0],[1,1],[2,2]])).toThrow('collinear');
});
it('constructs a counterclockwise arc of constant radius using an end direction',()=>{
 const c=sketchVariantContour('center-arc',[[0,0],[5,0],[0,20]]);
 if(c.type!=='path'||c.segments[0].type!=='arc')throw Error('arc');
 expect(c.segments[0].end[1]).toBeCloseTo(5);expect(c.segments[0].middle[0]).toBeCloseTo(Math.sqrt(12.5));
 validateSketchDrawing({type:'drawing',contours:[c]});
});
it('uses a vertex for inscribed polygons and a side midpoint for circumscribed polygons',()=>{
 for(const tool of ['inscribed-polygon','circumscribed-polygon'] as const){
  const c=sketchVariantContour(tool,[[0,0],[10,0]],5);
  if(c.type!=='path')throw Error('path');
  expect(c.segments).toHaveLength(5);
  if(tool==='inscribed-polygon')expect(Math.hypot(...c.start)).toBeCloseTo(10);
  else{const b=c.segments[0].end;expect((b[0]+c.start[0])/2).toBeCloseTo(10);expect((b[1]+c.start[1])/2).toBeCloseTo(0);}
  validateSketchDrawing({type:'drawing',contours:[c]});
 }
 expect(()=>sketchVariantContour('inscribed-polygon',[[0,0],[5,0]],2)).toThrow('3 to 100');
});
it('keeps ellipses and cubic Beziers as exact curve segments',()=>{
 const ellipse=sketchVariantContour('ellipse',[[0,0],[10,0],[0,3]]);
 if(ellipse.type!=='path')throw Error('path');
 expect(ellipse.segments).toHaveLength(2);expect(ellipse.segments[0].type).toBe('ellipse');
 validateSketchDrawing({type:'drawing',contours:[ellipse]});
 const bezier=sketchVariantContour('cubic-bezier',[[0,0],[0,10],[10,10],[10,0]]);
 validateSketchDrawing({type:'drawing',contours:[bezier]});
 expect(()=>sketchVariantContour('ellipse',[[0,0],[10,0],[3,0]])).toThrow('minor radius');
});

it('builds two-point circles, rounded rectangles, edge polygons and slots from two points', () => {
  const circle = sketchVariantContour('two-point-circle', [[0, 0], [10, 0]]);
  expect(circle).toEqual({ type: 'circle', center: [5, 0], radius: 5 });
  const rounded = sketchVariantContour('rounded-rectangle', [[0, 0], [20, 10]], 6, { cornerRadiusMillimeters: 2 });
  expect(rounded.type).toBe('path');
  if (rounded.type === 'path') { expect(rounded.segments.filter((s) => s.type === 'arc').length).toBe(4); expect(rounded.start).toEqual([2, 0]); expect(rounded.segments[1]).toMatchObject({ type: 'arc', end: [20, 2] }); }
  expect(() => sketchVariantContour('rounded-rectangle', [[0, 0], [20, 10]], 6, { cornerRadiusMillimeters: 6 })).toThrow(/half/);
  const square = sketchVariantContour('edge-polygon', [[0, 0], [10, 0]], 4);
  if (square.type === 'path') expect(square.segments.map((s) => s.end.map((v) => Math.round(v * 1e6) / 1e6))).toEqual([[10, 0], [10, 10], [0, 10], [0, 0]]);
  const slot = sketchVariantContour('center-slot', [[0, 0], [20, 0]], 6, { slotWidthMillimeters: 6 });
  if (slot.type === 'path') { expect(slot.start).toEqual([0, 3]); expect(slot.segments[0]).toMatchObject({ type: 'line', end: [20, 3] }); expect(slot.segments[1]).toMatchObject({ type: 'arc', middle: [23, 0], end: [20, -3] }); }
  const overall = sketchVariantContour('overall-slot', [[0, 0], [26, 0]], 6, { slotWidthMillimeters: 6 });
  if (overall.type === 'path') expect(overall.segments[1]).toMatchObject({ type: 'arc', middle: [26, 0], end: [23, -3] });
  const centred = sketchVariantContour('center-point-slot', [[10, 0], [20, 0]], 6, { slotWidthMillimeters: 6 });
  if (centred.type === 'path') expect(centred.segments[3]).toMatchObject({ type: 'arc', middle: [-3, 0], end: [0, 3] });
});

it('builds arc slots from a centre arc or three points on it', () => {
  // Centre arc about the origin, radius 20, from 0° to 90°; width 6 → outer radius 23, inner 17.
  const slot = sketchVariantContour('center-arc-slot', [[0, 0], [20, 0], [0, 20]], 6, { slotWidthMillimeters: 6 });
  expect(slot.type).toBe('path');
  if (slot.type === 'path') {
    expect(slot.start.map((v) => +v.toFixed(6) + 0)).toEqual([23, 0]);
    expect(slot.segments).toHaveLength(4);
    expect(slot.segments[0].type === 'arc' && slot.segments[0].end.map((v) => +v.toFixed(6) + 0)).toEqual([0, 23]);
    // The end cap bulges past the end along the tangent (+y side at 90° is -x... the tangent at 90° ccw is (-1,0)).
    expect(slot.segments[1].type === 'arc' && slot.segments[1].middle.map((v) => +v.toFixed(6) + 0)).toEqual([-3, 20]);
    expect(slot.segments[1].type === 'arc' && slot.segments[1].end.map((v) => +v.toFixed(6) + 0)).toEqual([0, 17]);
    expect(slot.segments[3].type === 'arc' && slot.segments[3].middle.map((v) => +v.toFixed(6) + 0)).toEqual([20, -3]);
  }
  // The same slot by three points on the centre arc; the through point picks the short way round.
  const three = sketchVariantContour('three-point-arc-slot', [[20, 0], [20 * Math.SQRT1_2, 20 * Math.SQRT1_2], [0, 20]], 6, { slotWidthMillimeters: 6 });
  expect(three.type === 'path' && three.start.map((v) => +v.toFixed(6) + 0)).toEqual([23, 0]);
  expect(three.type === 'path' && three.segments[0].type === 'arc' && three.segments[0].middle.map((v) => +v.toFixed(6) + 0)).toEqual([23 * Math.SQRT1_2, 23 * Math.SQRT1_2].map((v) => +v.toFixed(6) + 0));
  // Clockwise goes the long way: the end cap then bulges the other way.
  const cw = sketchVariantContour('center-arc-slot', [[0, 0], [20, 0], [0, 20]], 6, { slotWidthMillimeters: 6, clockwise: true });
  expect(cw.type === 'path' && cw.segments[1].type === 'arc' && cw.segments[1].middle.map((v) => +v.toFixed(6) + 0)).toEqual([3, 20]);
  expect(() => sketchVariantContour('center-arc-slot', [[0, 0], [2, 0], [0, 2]], 6, { slotWidthMillimeters: 6 })).toThrow(/exceed half/);
});

