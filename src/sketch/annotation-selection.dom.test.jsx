import { createRequire } from 'node:module';
import { beforeAll, beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument } from '@aether/core/document';
import { cadCommands } from '../cad-command-registry';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom, open, doc, apply, svg;
beforeAll(async () => {
  dom = new JSDOM('<body></body>', { url: 'http://localhost/cad/' });
  for (const key of ['window','document','HTMLElement','CustomEvent','Event','location']) vi.stubGlobal(key, dom.window[key]);
  open = (await import('../sketch-workspace')).openSketchWorkspace;
});
beforeEach(() => {
  document.body.innerHTML = '<div class="cad-studio-viewport"></div>';
  doc = createEmptyPartDocument('Annotation deletion');
  doc.features.push({ id: 's', type: 'profile', name: 'Sketch 1', plane: 'XY', offsetMillimeters: 0, suppressed: false,
    profile: { type: 'drawing', contours: [{ type: 'circle', center: [10,10], radius: 5 }], constraints: [
      { id: 'diameter', kind: 'diameter', a: { contour: 0, kind: 'circle' }, value: 10 },
      { id: 'fixed', kind: 'fix', a: { contour: 0, kind: 'point', index: 0 }, point: [10,10] },
    ] } });
  apply = vi.fn(async next => { doc = next; });
  window.addEventListener('aether-sketch-surface', e => {
    document.body.append(e.detail.svg); e.detail.connect({ toSketch: (x,y) => [x,-y], toClient: ([x,y]) => [x,-y], scaleAt: () => .1, updateBounds() {} });
  }, { once: true });
  open(() => doc, apply, doc.features[0]); svg = document.querySelector('.cad-sketch-canvas');
});
afterEach(() => document.querySelector('[aria-label="Cancel sketch"]')?.click());
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });
const click = (node, options = {}) => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ...options }));
const key = (key, options = {}) => document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
it('selects a dimension without editing geometry; Delete and undo preserve the circle and its other constraint', async () => {
  click(svg.querySelector('.sketch-dimension text'));
  expect(svg.querySelector('.sketch-dimension').classList.contains('sketch-annotation-selected')).toBe(true);
  expect(document.querySelector('.cad-sketch-dimension-entry')).toBeNull();
  expect(cadCommands.snapshot()['sketch-delete'].enabled).toBe(true);
  key('Delete'); expect(svg.querySelector('.sketch-dimension')).toBeNull();
  expect(svg.querySelectorAll('.sketch-contour')).toHaveLength(1);
  expect(svg.querySelector('[data-mark-for="fixed"]')).not.toBeNull();
  key('z', { ctrlKey: true }); expect(svg.querySelector('.sketch-dimension')).not.toBeNull();
  key('z', { ctrlKey: true, shiftKey: true });
  document.querySelector('[aria-label="Finish sketch"]').click(); await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
  const drawing = parsePartDocument(serializePartDocument(doc)).features[0].profile;
  expect(drawing.contours).toMatchObject([{ type: 'circle', radius: 5 }]); expect(drawing.constraints.map(c => c.id)).toEqual(['fixed']);
});
it('multi-selects a marker and dimension then removes only the relationships with the ribbon command', () => {
  click(svg.querySelector('[data-mark-for="fixed"]'));
  click(svg.querySelector('.sketch-dimension text'), { shiftKey: true });
  expect(svg.querySelectorAll('.sketch-annotation-selected')).toHaveLength(2);
  cadCommands.execute('sketch-delete');
  expect(svg.querySelector('.sketch-dimension')).toBeNull(); expect(svg.querySelector('[data-mark-for]')).toBeNull();
  expect(svg.querySelectorAll('.sketch-contour')).toHaveLength(1);
  key('z', { metaKey: true }); expect(svg.querySelector('[data-mark-for="fixed"]')).not.toBeNull(); expect(svg.querySelector('.sketch-dimension')).not.toBeNull();
});
it('selects a marker through forwarded world-surface coordinates', () => {
  const box = svg.querySelector('.constraint-badge-box');
  const x = Number(box.getAttribute('x')) + Number(box.getAttribute('width')) / 2;
  const y = Number(box.getAttribute('y')) + Number(box.getAttribute('height')) / 2;
  click(svg, { clientX: x, clientY: y }); key('Backspace');
  expect(svg.querySelector('[data-mark-for]')).toBeNull(); expect(svg.querySelector('.sketch-dimension')).not.toBeNull();
  expect(svg.querySelectorAll('.sketch-contour')).toHaveLength(1);
});
it('keeps dimension editing available on double-click after single-click selection', () => {
  const text = svg.querySelector('.sketch-dimension text');
  click(text, { detail: 1 }); expect(document.querySelector('.cad-sketch-dimension-entry')).toBeNull();
  click(text, { detail: 2 }); expect(document.querySelector('[aria-label="Dimension value"]')).not.toBeNull();
  expect(svg.querySelectorAll('.sketch-contour')).toHaveLength(1);
});
it('keeps a dragged dimension selected so Delete cannot remove previously selected geometry', () => {
  click(svg, { clientX: 15, clientY: -10 });
  const pointer = (target, type, x, y) => {
    const event = new dom.window.MouseEvent(type, { button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event);
  };
  pointer(svg.querySelector('.sketch-dimension text'), 'pointerdown', 0,0);
  pointer(svg, 'pointermove', 20,-15); pointer(svg, 'pointerup', 20,-15);
  key('Delete');
  expect(svg.querySelector('.sketch-dimension')).toBeNull(); expect(svg.querySelectorAll('.sketch-contour')).toHaveLength(1);
});
