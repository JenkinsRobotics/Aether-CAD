import { expect, it } from 'vitest';
import { editDrawingDimension, dragSketchEntity, type SketchDrawing, type SketchEntityRef } from '@aether/core/sketch';
import { constrainSketchSelection } from './constraint-selection';
const line = (contour: number): SketchEntityRef => ({ contour, kind: 'line', index: 0 });
const point = (contour: number): SketchEntityRef => ({ contour, kind: 'point', index: 0 });
const circle = (contour: number): SketchEntityRef => ({ contour, kind: 'circle' });
const lines = (): SketchDrawing => ({ type: 'drawing', contours: [0, 1, 2].map(i => ({ type: 'path', start: [i * 30, i * 20], segments: [{ type: 'line', end: [i * 30 + 10, i * 20 + i + 3] }] })) });
const circles = (): SketchDrawing => ({ type: 'drawing', contours: [4, 6, 8].map((radius, i) => ({ type: 'circle', center: [30 * i, 10 * i], radius })) });

it.each(['horizontal', 'vertical'] as const)('aligns every selected line with %s', kind => {
  const source = lines(), before = structuredClone(source);
  const result = constrainSketchSelection(source, kind, [0,1,2].map(line));
  expect(result.added).toBe(3); expect(source).toEqual(before);
  for (const c of result.drawing.contours) {
    if (c.type !== 'path') throw Error('Expected path');
    const axis = kind === 'horizontal' ? 1 : 0;
    expect(c.start[axis]).toBeCloseTo(c.segments[0].end[axis], 6);
  }
});
it.each(['horizontal', 'vertical'] as const)('aligns all points with %s while respecting a fixed point', kind => {
  const source = circles(); source.constraints = [{ id: 'origin', kind: 'fix', a: point(0), point: [0,0] }];
  const { drawing, added } = constrainSketchSelection(source, kind, [0,1,2].map(point));
  expect(added).toBe(2);
  for (const c of drawing.contours) {
    if (c.type !== 'circle') throw Error('Expected circle');
    expect(c.center[kind === 'horizontal' ? 1 : 0]).toBeCloseTo(0, 6);
  }
});
it('uses an existing radius driver for all selected circles and follows later edits and center drags', () => {
  const source = circles(); source.constraints = [{ id: 'radius', kind: 'radius', a: circle(1), value: 6 }];
  const { drawing } = constrainSketchSelection(source, 'equal', [0,1,2].map(circle));
  const roundTrip = JSON.parse(JSON.stringify(drawing));
  const edited = editDrawingDimension(roundTrip, 'radius', 9);
  const moved = dragSketchEntity(edited, point(2), [2, 3]);
  for (const c of moved.contours) { if (c.type !== 'circle') throw Error(); expect(c.radius).toBeCloseTo(9, 6); }
  expect(moved.constraints).toHaveLength(3);
});
it('keeps a length driver when making three lines equal', () => {
  const source = lines(); source.constraints = [{ id: 'length', kind: 'length', a: line(0), value: Math.sqrt(109) }];
  const { drawing } = constrainSketchSelection(source, 'equal', [0,1,2].map(line));
  for (const c of drawing.contours) { if (c.type !== 'path') throw Error(); expect(Math.hypot(c.segments[0].end[0] - c.start[0], c.segments[0].end[1] - c.start[1])).toBeCloseTo(Math.sqrt(109), 6); }
});
it('adds parallel and concentric relationships to all members', () => {
  expect(constrainSketchSelection(lines(), 'parallel', [0,1,2].map(line)).added).toBe(2);
  const { drawing, added } = constrainSketchSelection(circles(), 'concentric', [0,1,2].map(circle));
  expect(added).toBe(2);
  const centers = drawing.contours.map(c => c.type === 'circle' ? c.center : []);
  for (const c of centers) { expect(c[0]).toBeCloseTo(centers[0][0], 6); expect(c[1]).toBeCloseTo(centers[0][1], 6); }
});
it('normalizes point-first midpoint selection', () => {
  const source = lines(); source.contours.push({ type: 'path', start: [2,2], segments: [] });
  const { drawing } = constrainSketchSelection(source, 'midpoint', [point(3), line(0)]);
  expect(drawing.constraints?.[0]).toMatchObject({ a: line(0), b: point(3) });
});
it('joins every selected point and avoids redundant relations on reordered selections', () => {
  const source = circles(); source.constraints = [{ id: 'fixed', kind: 'fix', a: point(0), point: [0,0] }];
  const result = constrainSketchSelection(source, 'coincident', [0,1,2].map(point));
  expect(result.added).toBe(2);
  for (const c of result.drawing.contours) if (c.type === 'circle') { expect(c.center[0]).toBeCloseTo(0,6); expect(c.center[1]).toBeCloseTo(0,6); }
  expect(constrainSketchSelection(result.drawing, 'coincident', [2,1,0].map(point)).added).toBe(0);
});
it('uses a selected point as the common intersection of several selected lines', () => {
  const source = lines(); source.contours.push({ type: 'path', start: [5,5], segments: [] });
  const result = constrainSketchSelection(source, 'coincident', [line(0), line(1), point(3)]);
  expect(result.added).toBe(2);
  expect(result.drawing.constraints?.every(c => c.a.contour === 3)).toBe(true);
  expect(() => constrainSketchSelection(source, 'coincident', [line(0),line(1),line(2)])).toThrow(/shared point/);
});
it('fixes selected points or whole circles and rejects read-only projected geometry', () => {
  expect(constrainSketchSelection(circles(), 'fix', [0,1,2].map(point)).added).toBe(3);
  expect(constrainSketchSelection(circles(), 'fix', [circle(0)]).drawing.constraints?.[0].fixedGeometry).toEqual(circles().contours[0]);
  const source = circles(); source.projectionContext = [{ type: 'circle', id: 'external', center: [0,0], radius: 4 }];
  expect(() => constrainSketchSelection(source, 'fix', [{ contour: -1, kind: 'circle', projectedContourId: 'external' }])).toThrow(/read-only/);
});
it('rejects conflicting drivers atomically', () => {
  const source = circles(); source.constraints = [0,1].map(i => ({ id: `radius-${i}`, kind: 'radius', a: circle(i), value: i ? 6 : 4 }));
  const before = structuredClone(source);
  expect(() => constrainSketchSelection(source, 'equal', [0,1,2].map(circle))).toThrow();
  expect(source).toEqual(before);
});
it('rejects mixed and excessive selections instead of silently applying a subset', () => {
  const source = lines(); source.contours.push({ type: 'circle', center: [100,100], radius: 5 });
  expect(() => constrainSketchSelection(source, 'equal', [line(0), line(1), circle(3)])).toThrow(/together/);
  expect(() => constrainSketchSelection(source, 'horizontal', [line(0), point(1)])).toThrow(/two points/);
  expect(() => constrainSketchSelection(source, 'perpendicular', [0,1,2].map(line))).toThrow(/exactly two/);
});
it('deduplicates targets and repeated or reversed constraints without a new edit', () => {
  const first = constrainSketchSelection(circles(), 'equal', [circle(0), circle(1), circle(1)]);
  expect(first.added).toBe(1);
  const repeated = constrainSketchSelection(first.drawing, 'equal', [circle(1), circle(0)]);
  expect(repeated.added).toBe(0); expect(repeated.drawing).toBe(first.drawing);
  const group = constrainSketchSelection(first.drawing, 'equal', [0,1,2].map(circle));
  expect(group.added).toBe(1);
  expect(constrainSketchSelection(group.drawing, 'equal', [2,1,0].map(circle)).added).toBe(0);
});
it('honors read-only projected geometry while solving authored circles', () => {
  const source = circles(); source.projectionContext = [{ type: 'circle', id: 'source-circle', center: [100,100], radius: 12 }];
  const ref: SketchEntityRef = { contour: -1, kind: 'circle', projectedContourId: 'source-circle' };
  const { drawing } = constrainSketchSelection(source, 'equal', [circle(0), ref, circle(1)]);
  expect(drawing.projectionContext).toEqual(source.projectionContext);
  for (const c of drawing.contours.slice(0,2)) { if (c.type !== 'circle') throw Error(); expect(c.radius).toBeCloseTo(12, 6); }
});
