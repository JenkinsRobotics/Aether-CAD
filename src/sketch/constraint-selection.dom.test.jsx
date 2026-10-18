import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountConstraintPanel } from './constraint-panel';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom, panel, drawing, selected, commit, message;
const line = (x, y) => ({ type: 'path', start: [x, y], segments: [{ type: 'line', end: [x + 10, y + 3] }], closed: false });
beforeEach(() => {
  dom = new JSDOM('<main></main><svg></svg><p id="message"></p>');
  for (const k of ['window', 'document', 'HTMLElement', 'CustomEvent', 'Event']) vi.stubGlobal(k, dom.window[k]);
  drawing = { type: 'drawing', contours: [line(0, 0), line(20, 20), line(40, 40)] };
  selected = [0, 1, 2].map(contour => ({ contour, kind: 'line', index: 0 }));
  message = document.querySelector('#message');
  commit = vi.fn(next => { drawing = next; panel.refresh(); });
  panel = mountConstraintPanel({ parent: document.querySelector('main'), svg: document.querySelector('svg'), getDrawing: () => drawing, selection: () => selected, commit, coordinates: () => [0,0], chooseTool: vi.fn(), message });
  panel.refresh();
});
afterEach(() => { panel.dispose(); dom.window.close(); vi.unstubAllGlobals(); });
const command = kind => window.dispatchEvent(new CustomEvent('aether-sketch-constraint', { detail: kind }));
it('applies Horizontal to every selected line in one commit', () => {
  command('horizontal');
  expect(commit).toHaveBeenCalledOnce();
  expect(drawing.constraints).toHaveLength(3);
  for (const c of drawing.contours) expect(c.start[1]).toBeCloseTo(c.segments[0].end[1], 6);
  expect(message.textContent).toContain('3');
});
it('rejects the entire selected set instead of ignoring unsupported entities', () => {
  drawing.contours.push({ type: 'circle', center: [60,60], radius: 5 });
  selected.push({ contour: 3, kind: 'circle' });
  const before = structuredClone(drawing);
  command('horizontal');
  expect(commit).not.toHaveBeenCalled(); expect(drawing).toEqual(before);
  expect(message.textContent).toMatch(/line|point/i);
});
it('retains the manual entity fields when selecting targets one at a time', () => {
  selected = []; command('parallel');
  const a = document.querySelector('[aria-label="Entity A"]');
  const b = document.querySelector('[aria-label="Entity B"]');
  a.value = JSON.stringify({ contour: 0, kind: 'line', index: 0 });
  selected = [{ contour: 1, kind: 'line', index: 0 }]; panel.refreshSelection();
  b.value = JSON.stringify(selected[0]);
  expect(document.querySelector('[aria-label="Use selected geometry"]').checked).toBe(false);
  [...document.querySelectorAll('button')].find(b => b.textContent === 'Apply constraint').click();
  expect(commit).toHaveBeenCalledOnce();
  expect(drawing.constraints).toHaveLength(1);
});
it('reports duplicate commands without committing and can switch back to explicit entity fields', () => {
  command('horizontal'); command('horizontal');
  expect(commit).toHaveBeenCalledOnce(); expect(message.textContent).toContain('already');
  const toggle = document.querySelector('[aria-label="Use selected geometry"]');
  expect(toggle.checked).toBe(true);
  expect(document.querySelector('[aria-label="Entity A"]').disabled).toBe(true);
  toggle.click();
  expect(document.querySelector('[aria-label="Entity A"]').disabled).toBe(false);
});
