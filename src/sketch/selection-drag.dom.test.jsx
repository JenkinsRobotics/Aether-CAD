import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import { dragSketchEntity } from '@aether/core/sketch';
import { bindSelectionDrag } from './selection-drag';
import { renderSketchCanvas } from './canvas-renderer';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
let dom;
afterEach(() => { dom?.window.close(); vi.unstubAllGlobals(); });
const circle = (x, y, radius = 3) => ({ type: 'circle', center: [x, y], radius });
function setup(source = { type: 'drawing', contours: [circle(10, 10), circle(35, 30)] }) {
  dom = new JSDOM('<svg class="cad-sketch-canvas"></svg>');
  vi.stubGlobal('document', dom.window.document);
  const svg = document.querySelector('svg');
  let drawing = structuredClone(source);
  const render = () => renderSketchCanvas(svg, drawing, { x: -50, y: -50, width: 100, height: 100 }, []);
  const commit = vi.fn((before, after) => { drawing = after; render(); });
  const report = vi.fn();
  const binding = bindSelectionDrag({ svg, enabled: () => true, point: e => [e.clientX, e.clientY], drawing: () => drawing,
    tolerance: () => 1, snapTolerance: () => 1, snapping: () => true,
    preview: next => { drawing = next; render(); }, commit, report, select() {} });
  render();
  const pointer = (type, x, y, options = {}) => {
    const e = new dom.window.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, ...options });
    Object.defineProperty(e, 'pointerId', { value: 1 }); svg.dispatchEvent(e);
  };
  return { svg, pointer, commit, report, binding, drawing: () => drawing };
}
it('previews alignment with no saved constraint, breaks out of the snap, and commits only on release', () => {
  const t = setup();
  t.pointer('pointerdown', 10, 10);
  t.pointer('pointermove', 20, 29.5);
  expect(t.drawing().contours[0].center).toEqual([20, 30]);
  expect(t.drawing().constraints).toBeUndefined();
  expect(t.svg.dataset.selectionDrag).toBe('true');
  expect(t.svg.querySelector('[aria-label="Horizontal alignment guide"]')).not.toBeNull();
  expect(t.commit).not.toHaveBeenCalled();
  t.pointer('pointermove', 20, 33);
  expect(t.drawing().contours[0].center).toEqual([20, 33]);
  expect(t.svg.querySelector('.sketch-drag-guides')).toBeNull();
  t.pointer('pointerup', 20, 33);
  expect(t.commit).toHaveBeenCalledTimes(1);
  expect(t.drawing().constraints).toBeUndefined();
  expect(t.svg.hasAttribute('data-selection-drag')).toBe(false);
  expect(t.report).not.toHaveBeenCalled();
});
it('persists the acquired point alignment on release and keeps it when the target moves', () => {
  const t = setup();
  t.pointer('pointerdown', 10, 10); t.pointer('pointermove', 20, 29.5); t.pointer('pointerup', 20, 29.5);
  expect(t.drawing().constraints).toMatchObject([{ kind: 'horizontal', a: { contour: 0 }, b: { contour: 1 } }]);
  const moved = dragSketchEntity(t.drawing(), { contour: 1, kind: 'point', index: 0 }, [0, 5]);
  expect(moved.contours[0].center[1]).toBeCloseTo(35);
  expect(t.svg.querySelector('.sketch-drag-guides')).toBeNull();
});
it('uses release coordinates instead of committing an obsolete snapped preview', () => {
  const t = setup();
  t.pointer('pointerdown', 10, 10); t.pointer('pointermove', 20, 29.5); t.pointer('pointerup', 24, 35);
  expect(t.drawing().contours[0].center).toEqual([24, 35]);
  expect(t.drawing().constraints).toBeUndefined();
});
it('cancels geometry, guides and fill hiding without adding history', () => {
  const t = setup();
  t.pointer('pointerdown', 10, 10); t.pointer('pointermove', 20, 30); t.binding.cancel();
  expect(t.drawing().contours[0].center).toEqual([10, 10]);
  expect(t.svg.hasAttribute('data-selection-drag')).toBe(false);
  expect(t.svg.querySelector('.sketch-drag-guides')).toBeNull();
  expect(t.commit).not.toHaveBeenCalled();
  expect(t.binding.active()).toBe(false);
});
it('acquires a midpoint as a live relation and excludes linked rings from self-snapping', () => {
  const t = setup({ type: 'drawing', contours: [circle(10, 10), { type: 'path', start: [20, 20], segments: [{ type: 'line', end: [40, 20] }] }] });
  t.pointer('pointerdown', 10, 10); t.pointer('pointermove', 30.4, 20.2); t.pointer('pointerup', 30.4, 20.2);
  expect(t.drawing().contours[0].center).toEqual([30, 20]);
  expect(t.drawing().constraints).toMatchObject([{ kind: 'midpoint' }]);
  expect(t.report).not.toHaveBeenCalled();
});
it('moves concentric rings together without acquiring their moving centers', () => {
  const t = setup({ type: 'drawing', contours: [circle(10, 10), circle(10, 10, 6)], constraints: [{ id: 'concentric', kind: 'concentric', a: { contour: 0, kind: 'circle' }, b: { contour: 1, kind: 'circle' } }] });
  t.pointer('pointerdown', 10, 10); t.pointer('pointermove', 20, 22);
  expect(t.svg.querySelector('.sketch-drag-guides')).toBeNull();
  expect(t.drawing().contours[1].center[0]).toBeCloseTo(20);
  t.pointer('pointerup', 20, 22);
  expect(t.drawing().constraints).toHaveLength(1);
});
it('Alt temporarily bypasses snapping', () => {
  const t = setup(); t.pointer('pointerdown', 10, 10); t.pointer('pointermove', 20, 29.5, { altKey: true });
  expect(t.drawing().contours[0].center).toEqual([20, 29.5]);
  expect(t.svg.querySelector('.sketch-drag-guides')).toBeNull();
});

it('aligns an endpoint with a stationary vertex in the same contour', () => {
  const t = setup({ type: 'drawing', contours: [{ type: 'path', start: [10, 10], segments: [{ type: 'line', end: [30, 30] }] }] });
  t.pointer('pointerdown', 10, 10); t.pointer('pointermove', 30.5, 20);
  expect(t.drawing().contours[0].start).toEqual([30, 20]);
  expect(t.svg.querySelector('[aria-label="Vertical alignment guide"]')).not.toBeNull();
  t.pointer('pointerup', 30.5, 20);
  expect(t.drawing().constraints).toMatchObject([{ kind: 'vertical' }]);
});
it('rejects blocked movement without keeping an old snapped preview', () => {
  const t = setup({ type: 'drawing', contours: [circle(10, 10), circle(35, 30)], constraints: [{ id: 'fixed', kind: 'fix', a: { contour: 0, kind: 'point', index: 0 }, point: [10, 10] }] });
  t.pointer('pointerdown', 10, 10); t.pointer('pointermove', 20, 30); t.pointer('pointerup', 20, 30);
  expect(t.drawing().contours[0].center).toEqual([10, 10]);
  expect(t.drawing().constraints).toHaveLength(1);
  expect(t.svg.querySelector('.sketch-drag-guides')).toBeNull();
  expect(t.svg.hasAttribute('data-selection-drag')).toBe(false);
});
it('resizes a free circle from its perimeter, preserves the center and commits once', () => {
  const t = setup({ type: 'drawing', contours: [circle(10, 10, 5)] });
  t.pointer('pointerdown', 15, 10); t.pointer('pointermove', 22, 10);
  expect(t.drawing().contours[0]).toMatchObject({ center: [10, 10], radius: 12 });
  expect(t.drawing().constraints).toBeUndefined(); expect(t.commit).not.toHaveBeenCalled();
  t.pointer('pointerup', 25, 10);
  expect(t.drawing().contours[0].radius).toBeCloseTo(15); expect(t.commit).toHaveBeenCalledOnce();
});
it('cancels perimeter resizing and respects a driving diameter', () => {
  const source = { type: 'drawing', contours: [circle(10, 10, 5)], constraints: [{ id: 'd', kind: 'diameter', a: { contour: 0, kind: 'circle' }, value: 10 }] };
  const t = setup(source);
  t.pointer('pointerdown', 15, 10); t.pointer('pointermove', 25, 10);
  expect(t.drawing().contours[0].radius).toBe(5); expect(t.drawing().constraints).toEqual(source.constraints);
  t.binding.cancel(); expect(t.commit).not.toHaveBeenCalled();
  t.pointer('pointerdown', 10, 10); t.pointer('pointermove', 20, 22); t.pointer('pointerup', 20, 22);
  expect(t.drawing().contours[0]).toMatchObject({ radius: 5, center: [20, 22] });
});
it('allows changing a circle radius when only its center is fixed', () => {
  const t = setup({ type: 'drawing', contours: [circle(0,0,5)], constraints: [{ id: 'origin', kind: 'fix', a: { contour: 0, kind: 'point', index: 0 }, point: [0,0] }] });
  t.pointer('pointerdown', 5,0); t.pointer('pointermove', 12,0); t.pointer('pointerup', 12,0);
  expect(t.drawing().contours[0]).toMatchObject({ center: [0,0], radius: 12 });
  expect(t.drawing().constraints).toHaveLength(1); expect(t.report).not.toHaveBeenCalled();
});

it('drags a visible cubic tangent handle through the canonical constraints without moving fixed endpoints', () => {
  const source = { type: 'drawing', contours: [{ type: 'path', start: [10,10], segments: [{ type: 'bezier', controls: [[20,30],[40,30]], end: [50,10] }] }],
    constraints: [{id:'start',kind:'fix',a:{contour:0,kind:'point',index:0},point:[10,10]}, {id:'end',kind:'fix',a:{contour:0,kind:'point',index:1},point:[50,10]}] };
  const t = setup(source);
  expect(t.svg.querySelectorAll('.sketch-spline-control')).toHaveLength(2);
  t.pointer('pointerdown',20,30); t.pointer('pointermove',25,40); t.pointer('pointerup',25,40);
  expect(t.commit).toHaveBeenCalledOnce(); expect(t.report).not.toHaveBeenCalled();
  expect(t.drawing().contours[0]).toMatchObject({start:[10,10],segments:[{end:[50,10],controls:[[25,40],[40,30]]}]});
  expect(t.drawing().constraints).toEqual(source.constraints);
  t.pointer('pointerdown',25,40); t.pointer('pointermove',30,50); t.binding.cancel();
  expect(t.drawing().contours[0].segments[0].controls[0]).toEqual([25,40]);
  expect(t.commit).toHaveBeenCalledOnce();
});
