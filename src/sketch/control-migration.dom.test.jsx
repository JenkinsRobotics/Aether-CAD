import { createRequire } from 'node:module';
import { beforeAll, beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest';
import { createEmptyPartDocument } from '@aether/core/document';
import { cadCommands } from '../cad-command-registry';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom, open, doc, apply;
beforeAll(async () => {
  dom = new JSDOM('<body></body>', { url: 'http://localhost/cad/' });
  for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent', 'Event', 'location']) vi.stubGlobal(key, dom.window[key]);
  open = (await import('../sketch-workspace')).openSketchWorkspace;
});
beforeEach(() => {
  document.body.innerHTML = '<div class="cad-studio-viewport"></div>';
  doc = createEmptyPartDocument('Migration'); apply = vi.fn(async next => { doc = next; });
  open(() => doc, apply);
});
afterEach(() => document.querySelector('[aria-label="Cancel sketch"]')?.click());
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });
const plane = () => window.dispatchEvent(new CustomEvent('aether-sketch-plane', { detail: 'XY' }));
it('has one real finish/cancel pair, no test-only plane buttons or offscreen controls', async () => {
  expect(document.querySelector('.cad-header-committed')).toBeNull();
  expect([...document.querySelectorAll('button')].some(b => b.textContent === 'Top (XY)')).toBe(false);
  expect(document.querySelectorAll('[aria-label="Finish sketch"]')).toHaveLength(1);
  expect(document.querySelector('[aria-label="Finish sketch"]').disabled).toBe(true);
  plane(); document.querySelector('[aria-label="Finish sketch"]').click();
  await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
  expect(document.querySelector('.cad-sketch-workspace')).toBeNull();
});
it('routes the ribbon to a single visible editor and releases its commands on cancel', () => {
  plane(); expect(document.querySelector('.cad-sketch-tool-window')).toBeNull();
  cadCommands.execute('sketch-variables');
  expect(document.querySelector('[aria-label="Sketch editor"]').value).toBe('variables');
  expect([...document.querySelectorAll('button')].find(b => b.textContent === 'Add variable')).toBeTruthy();
  cadCommands.execute('sketch-constraints');
  expect(document.querySelectorAll('.cad-sketch-tool-window')).toHaveLength(1);
  expect(document.querySelector('[aria-label="Constraint"]')).toBeTruthy();
  expect([...document.querySelectorAll('button')].find(b => b.textContent === 'Add variable')).toBeUndefined();
  document.querySelector('[aria-label="Cancel sketch"]').click();
  expect(cadCommands.execute('sketch-constraints')).toBe(false);
  expect(cadCommands.execute('sketch-undo')).toBe(false);
});
it('creates geometry through visible coordinate controls and uses direct undo/redo commands', async () => {
  plane(); window.dispatchEvent(new CustomEvent('aether-sketch-tool', { detail: 'line' }));
  const point = (x, y) => {
    document.querySelector('[aria-label="X (mm)"]').value = x;
    document.querySelector('[aria-label="Y (mm)"]').value = y;
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Place point').click();
  };
  point(0, 0); point(0, 20);
  expect(document.querySelectorAll('.sketch-contour')).toHaveLength(1);
  expect([...document.querySelectorAll('button')].find(b => b.textContent === 'Undo')).toBeUndefined();
  cadCommands.execute('sketch-undo'); expect(document.querySelectorAll('.sketch-contour')).toHaveLength(0);
  cadCommands.execute('sketch-redo'); expect(document.querySelectorAll('.sketch-contour')).toHaveLength(1);
  document.querySelector('[aria-label="Finish sketch"]').click();
  await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
  expect(doc.features[0].profile.contours[0].segments[0].end).toEqual([0,20]);
});
