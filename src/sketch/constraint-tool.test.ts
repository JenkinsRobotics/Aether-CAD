import { expect, it, vi } from 'vitest';
import type { SketchDrawing, SketchEntityRef } from '@aether/core/sketch';
import { createConstraintTool } from './constraint-tool';

const line = (contour: number): SketchEntityRef => ({ contour, kind: 'line', index: 0 });
const point = (contour: number): SketchEntityRef => ({ contour, kind: 'point', index: 0 });
function setup(source: SketchDrawing) {
  let drawing = source;
  const commit = vi.fn((next: SketchDrawing) => { drawing = next; });
  const report = vi.fn(), select = vi.fn(), changed = vi.fn();
  const tool = createConstraintTool({ drawing: () => drawing, options: () => ({}), commit, report, select, changed });
  return { tool, commit, report, select, changed, drawing: () => drawing };
}
const lines = (): SketchDrawing => ({ type: 'drawing', contours: [0,1].map(i => ({ type: 'path', start: [i*20, i*30], segments: [{ type: 'line', end: [i*20+10, i*30+3] }] })) });

it.each(['horizontal', 'vertical'] as const)('applies %s one line at a time, then a point pair, until canceled', kind => {
  const h = setup(lines()); h.tool.begin(kind);
  h.tool.pick(line(0)); h.tool.pick(line(1)); expect(h.commit).toHaveBeenCalledTimes(2);
  const axis = kind === 'horizontal' ? 1 : 0;
  for (const c of h.drawing().contours) if (c.type === 'path') expect(c.start[axis]).toBeCloseTo(c.segments[0].end[axis], 6);
  h.tool.pick(point(0)); expect(h.commit).toHaveBeenCalledTimes(2);
  h.tool.pick(point(1)); expect(h.commit).toHaveBeenCalledTimes(3);
  expect(h.tool.active()).toBe(true); h.tool.cancel(); expect(h.tool.pick(line(0))).toBe(false);
});
it('waits for a symmetry line and retries an invalid axis without losing the pair', () => {
  const h = setup({ type: 'drawing', contours: [
    { type: 'path', start: [-5,4], segments: [] }, { type: 'path', start: [8,7], segments: [] },
    { type: 'path', start: [0,-10], segments: [{ type: 'line', end: [0,10] }] },
  ], constraints: [ { id: 'a', kind: 'fix', a: point(2), point: [0,-10] }, { id: 'b', kind: 'fix', a: { ...point(2), index: 1 }, point: [0,10] } ] });
  h.tool.begin('symmetric'); h.tool.pick(point(0)); h.tool.pick(point(1));
  expect(h.commit).not.toHaveBeenCalled(); expect(h.tool.prompt()).toContain('symmetry line');
  h.tool.pick(point(2)); expect(h.commit).not.toHaveBeenCalled();
  h.tool.pick(line(2)); expect(h.commit).toHaveBeenCalledOnce();
  const [a,b] = h.drawing().contours;
  if (a.type !== 'path' || b.type !== 'path') throw Error();
  expect(a.start[0]).toBeCloseTo(-b.start[0],6); expect(a.start[1]).toBeCloseTo(b.start[1],6);
});
it('accepts point-first midpoint picking and deselects a repeated unfinished pick', () => {
  const h = setup({ ...lines(), contours: [...lines().contours, { type: 'path', start: [7,4], segments: [] }] });
  h.tool.begin('midpoint'); h.tool.pick(point(2)); h.tool.pick(point(2));
  expect(h.tool.prompt()).toContain('first entity');
  h.tool.pick(point(2)); h.tool.pick(line(0));
  expect(h.drawing().constraints?.[0]).toMatchObject({ kind: 'midpoint', a: line(0), b: point(2) });
});
it('fixes successive points without changing geometry and does not duplicate an existing lock', () => {
  const h = setup(lines()); const before = structuredClone(h.drawing().contours);
  h.tool.begin('fix'); h.tool.pick(point(0)); h.tool.pick(point(1)); h.tool.pick(point(0));
  expect(h.commit).toHaveBeenCalledTimes(2); expect(h.drawing().contours).toEqual(before);
  expect(h.report.mock.lastCall?.[0]).toContain('already exists');
});
it('uses projected geometry as a read-only target and retains stable references', () => {
  const source: SketchDrawing = { type: 'drawing', contours: [{ type: 'circle', center: [0,0], radius: 4 }], projectionContext: [{ id: 'external', type: 'circle', center: [20,20], radius: 9 }] };
  const h = setup(source); h.tool.begin('equal');
  h.tool.pick({ contour: 0, kind: 'circle' }); h.tool.pick({ contour: -1, kind: 'circle', projectedContourId: 'external' });
  expect(h.commit).toHaveBeenCalledOnce(); expect(h.drawing().projectionContext).toEqual(source.projectionContext);
  const circle = h.drawing().contours[0]; if (circle.type !== 'circle') throw Error();
  expect(circle.radius).toBeCloseTo(9, 6);
  expect(h.drawing().constraints?.[0].b?.projectedContourId).toBe('external');
});
