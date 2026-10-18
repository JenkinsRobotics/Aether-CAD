import { clickSketchControl, querySketchControl, querySketchControls } from "./test-controls";
import { createRequire } from 'node:module';
import { beforeAll, beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument } from '@aether/core/document';
import { cadCommands } from '../cad-command-registry';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
let dom, open, svg, doc, apply;
beforeAll(async () => {
  dom = new JSDOM('<body></body>', { url: 'http://localhost/cad/' });
  for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent', 'Event', 'location']) vi.stubGlobal(key, dom.window[key]);
  open = (await import('../sketch-workspace')).openSketchWorkspace;
});
beforeEach(() => {
  document.body.innerHTML = '<div class="cad-studio-viewport"></div>';
  doc = createEmptyPartDocument('Selection actions');
  doc.features.push({ id: 's', name: 'Sketch 1', type: 'profile', plane: 'XY', offsetMillimeters: 0, suppressed: false,
    profile: { type: 'drawing', contours: [
      { type: 'path', start: [0, 0], segments: [{ type: 'line', end: [20, 0] }] },
      { type: 'circle', center: [40, 20], radius: 5 },
    ], constraints: [] } });
  apply = vi.fn(async next => { doc = next; });
  window.addEventListener('aether-sketch-surface', e => {
    document.body.append(e.detail.svg);
    e.detail.connect({ toSketch: (x, y) => [x, -y], toClient: ([x, y]) => [x, -y], scaleAt: () => .1, updateBounds() {} });
  }, { once: true });
  open(() => doc, apply, doc.features[0]); svg = querySketchControl('svg.cad-sketch-canvas');
});
const button = text => ['Undo', 'Redo'].includes(text) ? { click: () => clickSketchControl(text) } : [...querySketchControls('button')].find(b => b.textContent === text || b.getAttribute('aria-label') === (text === 'Cancel' ? 'Cancel sketch' : text));
afterEach(() => button('Cancel')?.click());
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });
const pick = (x, y) => svg.dispatchEvent(new dom.window.MouseEvent('click', { clientX: x, clientY: -y, bubbles: true }));
const key = (key, target = document.body, options = {}) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
it('deletes selected geometry from the world surface with undo/redo and keeps Delete inside fields', async () => {
  pick(10, 0); expect(cadCommands.snapshot()['sketch-delete'].enabled).toBe(true);
  const input = document.createElement('input'); document.body.append(input); key('Delete', input);
  expect(svg.querySelectorAll('.sketch-contour')).toHaveLength(2);
  key('Delete'); expect(svg.querySelectorAll('.sketch-contour')).toHaveLength(1);
  expect(svg.querySelector('circle.sketch-contour')).not.toBeNull();
  key('z', document.body, { metaKey: true }); expect(svg.querySelectorAll('.sketch-contour')).toHaveLength(2);
  key('z', document.body, { metaKey: true, shiftKey: true }); expect(svg.querySelectorAll('.sketch-contour')).toHaveLength(1);
  button('Finish sketch').click(); await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
  expect(parsePartDocument(serializePartDocument(doc)).features[0].profile.contours).toMatchObject([{ type: 'circle' }]);
});
it('Q toggles new construction lines and the ribbon command converts selected geometry', async () => {
  key('q'); expect(cadCommands.snapshot()['sketch-construction'].active).toBe(true);
  window.dispatchEvent(new CustomEvent('aether-sketch-tool', { detail: 'line' }));
  pick(60, 0); pick(60, 25);
  expect(svg.querySelectorAll('.sketch-contour.construction')).toHaveLength(1);
  key('Escape'); pick(45, 20); cadCommands.execute('sketch-construction');
  expect(svg.querySelectorAll('.sketch-contour.construction')).toHaveLength(2);
  button('Undo').click(); expect(svg.querySelectorAll('.sketch-contour.construction')).toHaveLength(1);
  button('Redo').click(); button('Finish sketch').click(); await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
  expect(parsePartDocument(serializePartDocument(doc)).features[0].profile.contours.filter(c => c.construction)).toHaveLength(2);
});
