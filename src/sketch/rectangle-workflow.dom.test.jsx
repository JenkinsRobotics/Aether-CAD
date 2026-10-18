import { createRequire } from 'node:module';
import { beforeAll, beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument } from '@aether/core/document';
import { editDrawingDimension, sketchConstraintState, dragSketchEntity } from '@aether/core/sketch';
import { querySketchControl as q, clickSketchControl as click } from './test-controls';
import { snapSketchPoint } from '../sketch-snapping';
import { pickSketchEntity } from './picking';
import { sketchPointRole } from './point-roles';
import { applyDocumentUnits } from '../document-preferences';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom, open, doc, apply;
beforeAll(async () => {
  dom = new JSDOM('<div class="cad-studio-viewport"></div>', { url: 'http://localhost/cad/' });
  for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent', 'Event', 'location']) vi.stubGlobal(key, dom.window[key]);
  open = (await import('../sketch-workspace')).openSketchWorkspace;
});
beforeEach(() => {
  document.body.innerHTML = '<div class="cad-studio-viewport"></div>';
  doc = createEmptyPartDocument('Rectangle workflow'); applyDocumentUnits({});
  apply = vi.fn(async next => { doc = next; });
  open(() => doc, apply); click('Top (XY)');
});
afterEach(() => { q('[aria-label="Cancel sketch"]')?.click(); });
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });
const tool = name => window.dispatchEvent(new CustomEvent('aether-sketch-tool', { detail: name }));
const point = (x, y) => { q('[aria-label="X (mm)"]').value = x; q('[aria-label="Y (mm)"]').value = y; click('Place point'); };
function pointer(type, x, y, altKey = false) {
  const svg = q('[aria-label="2D sketch canvas"]');
  svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } });
  svg.getScreenCTM = () => ({ a: 1, b: 0, inverse: () => ({}) });
  const e = new dom.window.MouseEvent(type, { clientX: x, clientY: -y, altKey, bubbles: true, cancelable: true, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 }); svg.dispatchEvent(e);
}
async function save() {
  click('Finish sketch'); await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  doc = parsePartDocument(serializePartDocument(doc)); return doc.features[0].profile;
}
const dimensions = (w, h) => { q('[aria-label="New rectangle width (mm)"]').value = w; q('[aria-label="New rectangle height (mm)"]').value = h; click('Set rectangle dimensions'); };

it('keeps an origin-centered rectangle fixed, with driving width/height and editable dimensions after reopen', async () => {
  tool('center-rectangle'); pointer('click', 0, 0); pointer('click', 10, 5);
  const node = q('[data-node-role="Rectangle center"]'); expect(node).toBeTruthy();
  expect(node.classList.contains('sketch-center-node')).toBe(true);
  dimensions('40', '12');
  const d = await save();
  expect(d.contours[0].start[0]).toBeCloseTo(-20, 5); expect(d.contours[0].start[1]).toBeCloseTo(-6, 5);
  for (const value of d.contours[2].start) expect(value).toBeCloseTo(0, 6);
  expect(sketchConstraintState(d).state).toBe('fully-constrained');
  expect(Object.keys(doc.sketchPresentation[doc.features[0].id].dimensionLabelPositionsMillimeters).length).toBeGreaterThan(0);
  const changed = editDrawingDimension(d, d.constraints.find(c => c.kind === 'length' && c.a.index === 0).id, 60);
  expect(changed.contours[0].start[0]).toBeCloseTo(-30, 5); for (const value of changed.contours[2].start) expect(value).toBeCloseTo(0, 6);
  open(() => doc, apply, doc.features[0]);
  expect(q('[data-node-role="Rectangle center"]')).toBeTruthy();
  expect(q('.sketch-dimension')).toBeTruthy();
  expect([...q('[aria-label="Entity A"]').options].some(o => o.textContent.includes('Rectangle center'))).toBe(true);
});

it('snaps another profile to the persistent center and follows it through a constrained drag', async () => {
  tool('center-rectangle'); pointer('click', 20, 20); pointer('click', 30, 25);
  tool('circle'); pointer('pointermove', 20.1, 20.1);
  expect(q('svg').dataset.inferredConstraint).toBe('Rectangle center');
  pointer('click', 20.1, 20.1); pointer('click', 23, 20);
  const d = await save();
  expect(snapSketchPoint([20.1, 20.1], { ...d, contours: d.contours.slice(0, 3) }, undefined, 0.5, false).label).toBe('Rectangle center');
  expect(pickSketchEntity(d, [20,20]).label).toContain('Rectangle center');
  expect(d.constraints.some(c => c.kind === 'coincident' && c.a.contour === 3 && c.b?.contour === 2)).toBe(true);
  const moved = dragSketchEntity(d, { contour: 2, kind: 'point', index: 0 }, [7, 9]);
  expect(moved.contours[2].start[0]).toBeCloseTo(27, 4);
  expect(moved.contours[3].center[0]).toBeCloseTo(27, 4);
  expect(moved.contours[3].center[1]).toBeCloseTo(29, 4);
  const unlinked = { ...d, constraints: d.constraints.filter(c => c.kind !== 'midpoint') };
  expect(sketchPointRole(unlinked, { contour: 2, kind: 'point', index: 0 })).toBe('Point');
});

it.each(['rectangle', 'center-rectangle'])('places %s with click-drag as one undo transaction and cancels unfinished drags', async name => {
  tool(name); pointer('pointerdown', 20, 20); pointer('pointermove', 30, 25);
  expect(q('.sketch-preview')).toBeTruthy(); expect(q('.sketch-contour')).toBeNull();
  pointer('pointerup', 30, 25); pointer('click', 30, 25);
  expect(q('.sketch-contour')).toBeTruthy(); expect(q('.sketch-recent-rectangle').hidden).toBe(false);
  click('Undo'); expect(q('.sketch-contour')).toBeNull();
  click('Redo'); expect(q('.sketch-contour')).toBeTruthy();
  const before = q('.sketch-contour').getAttribute('d');
  pointer('pointerdown', 50, 50); pointer('pointermove', 60, 70); pointer('pointercancel', 60, 70);
  expect(q('.sketch-preview')).toBeNull(); expect(q('.sketch-contour').getAttribute('d')).toBe(before);
  expect((await save()).contours.filter(c => !c.construction)).toHaveLength(1);
});

it.each(['rectangle', 'center-rectangle'])('saves Alt-%s as a square with one dimension and an Equal constraint', async name => {
  tool(name); pointer('pointerdown', 0, 0); pointer('pointermove', 10, 6, true); pointer('pointerup', 10, 6, true); pointer('click', 10, 6, true);
  expect(q('[aria-label="New rectangle height (mm)"]').disabled).toBe(true);
  dimensions('24', '999');
  const d = await save();
  expect(d.constraints.filter(c => c.kind === 'equal')).toHaveLength(1);
  expect(d.constraints.filter(c => c.kind === 'length')).toHaveLength(1);
  expect(sketchConstraintState(d).state).toBe('fully-constrained');
  const resized = editDrawingDimension(d, d.constraints.find(c => c.kind === 'length').id, 50);
  const p = resized.contours[0], b = p.segments[0].end, c = p.segments[1].end;
  expect(Math.abs(b[0] - p.start[0])).toBeCloseTo(50, 5); expect(Math.abs(c[1] - b[1])).toBeCloseTo(50, 5);
});

it('does not apply invalid dimensions, preserves undo and supports keyboard width then height', async () => {
  tool('rectangle'); point(0, 0); point(12, 8);
  const before = q('.sketch-contour').getAttribute('d');
  dimensions('20', '-4'); expect(q('.sketch-contour').getAttribute('d')).toBe(before);
  expect(q('.sketch-recent-rectangle').hidden).toBe(false);
  const w = q('[aria-label="New rectangle width (mm)"]'), h = q('[aria-label="New rectangle height (mm)"]');
  w.value = '30/2'; w.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(document.activeElement).toBe(h); h.value = '6'; h.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(q('.sketch-recent-rectangle').hidden).toBe(true);
  click('Undo'); expect(q('.sketch-contour').getAttribute('d')).toBe(before); click('Redo');
  expect((await save()).constraints.filter(c => c.kind === 'length').map(c => c.value)).toEqual([15, 6]);
});

it('dimensions an aligned rectangle without removing its right angles', async () => {
  tool('aligned-rectangle'); point(10, 10); point(18, 16); point(7, 14); dimensions('20','8');
  const d = await save(), p = d.contours[0], a = p.start, b = p.segments[0].end, c = p.segments[1].end;
  expect(Math.hypot(b[0]-a[0],b[1]-a[1])).toBeCloseTo(20,5); expect(Math.hypot(c[0]-b[0],c[1]-b[1])).toBeCloseTo(8,5);
  expect((b[0]-a[0])*(c[0]-b[0]) + (b[1]-a[1])*(c[1]-b[1])).toBeCloseTo(0,5);
});


it('converts creation dimensions when switching document units without changing saved millimeters', async () => {
  tool('center-rectangle'); point(0,0); point(12.7,6.35);
  applyDocumentUnits({ length: { unit: 'in', decimals: 3 } });
  const width = q('[aria-label="New rectangle width (in)"]');
  expect(Number(width.value)).toBeCloseTo(1);
  width.value = '2'; q('[aria-label="New rectangle height (in)"]').value = '1/2'; click('Set rectangle dimensions');
  const d = await save(); expect(d.constraints.filter(c=>c.kind === 'length').map(c=>c.value)).toEqual([50.8,12.7]);
});


it('keeps an acquired origin snap when the opposite corner is entered numerically', async () => {
  tool('center-rectangle'); pointer('click', 0, 0); point(20,10); dimensions('50','30');
  const d = await save();
  expect(sketchConstraintState(d).state).toBe('fully-constrained');
  for (const value of d.contours[2].start) expect(value).toBeCloseTo(0,6);
});
