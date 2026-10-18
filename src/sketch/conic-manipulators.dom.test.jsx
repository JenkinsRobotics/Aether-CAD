import { createRequire } from 'node:module';
import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument } from '@aether/core/document';
import { createSketchConic } from '../../freecad-engine/browser/conic-authoring';
import { fixedEntityConstraint } from '../../freecad-engine/browser/fixed-geometry';
import { pickSketchEditEntity } from './edit-picking';
import { clickSketchControl as click, querySketchControl as q } from './test-controls';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom, open;
beforeAll(async () => {
  dom = new JSDOM('<div class="cad-studio-viewport"></div>', { url: 'http://localhost/cad/' });
  for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent', 'Event', 'location']) vi.stubGlobal(key, dom.window[key]);
  open = (await import('../sketch-workspace')).openSketchWorkspace;
});
afterEach(() => { if (q('.cad-sketch-workspace')) click('Cancel'); });
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });
function setup(change = d => d) {
  let doc = createEmptyPartDocument('Conic handles');
  const drawing = change(createSketchConic({ type: 'drawing', contours: [] }, [[0, 0], [20, 0], [10, 20], [10, 6]]));
  doc.features.push({ id: 's', type: 'profile', name: 'Sketch 1', plane: 'XY', offsetMillimeters: 0, suppressed: false, profile: drawing });
  const apply = vi.fn(async next => { doc = next; }); open(() => doc, apply, doc.features[0]);
  window.dispatchEvent(new CustomEvent('aether-sketch-tool', { detail: 'select' }));
  const svg = q('.cad-sketch-workspace svg');
  svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } });
  svg.getScreenCTM = () => ({ inverse: () => ({}) });
  const pointer = (type, x, y, options = {}) => {
    const e = new dom.window.MouseEvent(type, { clientX: x, clientY: -y, button: 0, bubbles: true, altKey: true, ...options });
    Object.defineProperty(e, 'pointerId', { value: 1 }); svg.dispatchEvent(e);
  };
  const handle = () => svg.querySelector('[data-conic-handle="rho"]');
  const height = () => -Number(handle().getAttribute('cy'));
  const drag = (x, y, options) => { pointer('pointerdown', 10, height(), options); pointer('pointermove', x, y, options); pointer('pointerup', x, y, options); };
  const save = async () => { click('Finish sketch'); await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce()); return parsePartDocument(serializePartDocument(doc)); };
  return { svg, pointer, handle, height, drag, save, before: drawing, apply };
}
it('renders and picks the derived handle, changes rho with one undo/redo, and reopens the exact saved curve', async () => {
  const t = setup(); expect(t.handle().getAttribute('aria-label')).toContain('ρ 0.3');
  expect(pickSketchEditEntity(t.before, [10, 6], t.svg).conicHandle).toBeDefined();
  t.drag(14, 14); expect(t.height()).toBe(14);
  expect(q('[data-node-control="0"]').getAttribute('cy')).toBe('-20');
  click('Undo'); expect(t.height()).toBe(6); click('Redo'); expect(t.height()).toBe(14);
  const saved = await t.save(), d = saved.features[0].profile;
  expect(d.contours).toHaveLength(1); expect(d.constraints).toHaveLength(1); expect(d.constraints[0].value).toBe(.7);
  expect(d.contours[0].segments[0]).toMatchObject({ type: 'conic', end: [20, 0], control: [10, 20], rho: .7 });
  open(() => saved, t.apply, saved.features[0]); expect(-Number(q('[data-conic-handle="rho"]').getAttribute('cy'))).toBe(14);
});
it('cancels a dragged curvature without leaving a dimension edit or extra undo step', async () => {
  const t = setup(); t.pointer('pointerdown', 10, 6); t.pointer('pointermove', 10, 16); expect(t.height()).toBe(16);
  t.pointer('pointercancel', 10, 16); expect(t.height()).toBe(6);
  const saved = await t.save(); expect(saved.features[0].profile).toEqual(t.before);
});
it('snaps to parabolic curvature with feedback and Alt bypasses the snap without inventing a point constraint', async () => {
  const t = setup();
  t.pointer('pointerdown', 10, 6, { altKey: false }); t.pointer('pointermove', 10, 10.1, { altKey: false });
  expect(t.svg.dataset.inferredConstraint).toContain('Parabola'); expect(t.height()).toBe(10);
  t.pointer('pointerup', 10, 10.1, { altKey: false }); expect(t.svg.dataset.inferredConstraint).toBeUndefined();
  t.drag(10, 14.1); expect(t.height()).toBeCloseTo(14.1, 10);
  const saved = await t.save(); expect(saved.features[0].profile.constraints).toHaveLength(1);
  expect(saved.features[0].profile.constraints[0].value).toBeCloseTo(.705, 12);
});
it.each(['formula', 'fixed'])('preserves %s-driven curves during handle dragging', async mode => {
  const t = setup(d => {
    if (mode === 'formula') d.constraints[0].valueExpression = '3/10';
    else d.constraints.push(fixedEntityConstraint(d, { contour: 0, kind: 'curve', index: 0, parameter: .5 }));
    return d;
  });
  t.drag(10, 15); expect(t.height()).toBe(6);
  const saved = await t.save(); expect(saved.features[0].profile).toEqual(t.before);
});
it('does not steal an overlapping actual point from the curvature handle', () => {
  const t = setup(d => { d.contours.unshift({ type: 'path', start: [10, 6], segments: [] }); d.constraints[0].a.contour++; return d; });
  const hit = pickSketchEditEntity(t.before, [10, 6], t.svg);
  expect(hit.ref).toMatchObject({ contour: 0, kind: 'point' }); expect(hit.conicHandle).toBeUndefined();
});
it('colors fixed conic nodes and subsequent free spline handles independently', () => {
  const t = setup(d => {
    d.constraints.push(fixedEntityConstraint(d, { contour: 0, kind: 'curve', index: 0, parameter: .5 }));
    d.contours.push({ type: 'path', start: [40, 0], segments: [{ type: 'bezier', controls: [[45, 10], [55, 10]], end: [60, 0] }] }); return d;
  });
  expect(t.svg.querySelector('[data-entity-contour="0"]').getAttribute('data-entity-constraint-state')).toBe('fully-constrained');
  expect(t.svg.querySelector('[data-node-contour="0"][data-node-control="0"]').getAttribute('data-entity-constraint-state')).toBe('fully-constrained');
  for (const n of t.svg.querySelectorAll('[data-node-contour="1"][data-node-control]')) expect(n.getAttribute('data-entity-constraint-state')).toBe('under-constrained');
});
