import { clickSketchControl, querySketchControl, querySketchControls } from "./test-controls";
import { createRequire } from 'node:module';
import { beforeAll, beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest';
import { createEmptyPartDocument } from '@aether/core/document';
import { cadSelection } from '../cad-selection-store';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
let dom, open, svg;
beforeAll(async () => {
  dom = new JSDOM('<body></body>', { url: 'http://localhost/cad/' });
  for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent', 'Event', 'location']) vi.stubGlobal(key, dom.window[key]);
  open = (await import('../sketch-workspace')).openSketchWorkspace;
});
beforeEach(() => {
  document.body.innerHTML = '<div class="cad-studio-viewport"></div>';
  cadSelection.dispatch({ type: 'replace', items: [] });
  const doc = createEmptyPartDocument('Selection');
  doc.features.push({ id: 's', name: 'Sketch 1', type: 'profile', plane: 'XY', offsetMillimeters: 0, suppressed: false,
    profile: { type: 'drawing', contours: [
      { type: 'path', start: [0, 0], segments: [{ type: 'line', end: [20, 0] }, { type: 'line', end: [20, 20] }, { type: 'line', end: [0, 0] }] },
      { type: 'circle', center: [40, 20], radius: 5 },
    ], constraints: [] } });
  window.addEventListener('aether-sketch-surface', e => {
    document.body.append(e.detail.svg);
    e.detail.connect({ toSketch: (x, y) => [(x - 100) / 4, (200 - y) / 4], toClient: ([x, y]) => [100 + x * 4, 200 - y * 4], scaleAt: () => .25, updateBounds() {} });
  }, { once: true });
  open(() => doc, vi.fn(), doc.features[0]);
  svg = querySketchControl('svg.cad-sketch-canvas');
});
afterEach(() => [...querySketchControls('button')].find(b => b.getAttribute('aria-label') === 'Cancel sketch')?.click());
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });
function pointer(type, x, y, options = {}) {
  const e = new dom.window.MouseEvent(type, { clientX: 100 + x * 4, clientY: 200 - y * 4, button: 0, bubbles: true, cancelable: true, ...options });
  Object.defineProperty(e, 'pointerId', { value: 1 }); svg.dispatchEvent(e);
}
const highlights = () => [...svg.querySelectorAll('.sketch-selection')];
it('previews every edge of multiple profiles, then persists the real selection after release and generated click', () => {
  pointer('pointerdown', -10, 30); pointer('pointermove', 50, -10);
  expect(highlights()).toHaveLength(4); expect(cadSelection.snapshot().items).toHaveLength(0);
  expect(highlights().map(n => n.dataset.entityKind)).toEqual(['line', 'line', 'line', 'circle']);
  expect(highlights()[0].firstElementChild.getAttribute('d')).toBe('M0,0L20,0');
  pointer('pointerup', 50, -10); pointer('click', 50, -10); pointer('pointermove', 60, -20);
  expect(highlights()).toHaveLength(4); expect(cadSelection.snapshot().items).toHaveLength(4);
  expect(querySketchControl('.cad-sketch-selection-box')).toBeNull();
});
it('selects a vertex, previews additive geometry, and restores selection on cancellation', () => {
  pointer('pointerdown', 16, 24); pointer('pointermove', 24, 16); pointer('pointerup', 24, 16); pointer('click', 24, 16);
  expect(highlights()).toHaveLength(1); expect(highlights()[0].dataset.entityKind).toBe('point');
  expect(cadSelection.snapshot().items[0].kind).toBe('vertex');
  pointer('pointerdown', 30, 30); pointer('pointermove', 50, 10, { shiftKey: true });
  expect(highlights()).toHaveLength(2); expect(cadSelection.snapshot().items).toHaveLength(1);
  pointer('pointercancel', 50, 10);
  expect(highlights()).toHaveLength(1); expect(highlights()[0].dataset.entityKind).toBe('point');
  expect(cadSelection.snapshot().items).toHaveLength(1);
});
