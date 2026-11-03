import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { parsePartDocument } from '@aether/core/document';

const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom, mount, open;
beforeAll(async () => {
  dom = new JSDOM('<!doctype html><body><div class="cad-studio-viewport"></div></body>', { url: 'http://localhost/cad/' });
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'CustomEvent', 'Event', 'KeyboardEvent', 'PointerEvent', 'MouseEvent', 'Node', 'location'])
    vi.stubGlobal(key, dom.window[key] ?? dom.window.MouseEvent);
  ({ mountSketch3DWorkspace: mount, openSketch3DWorkspace: open } = await import('./sketch3d-workspace'));
});
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });

it('draws a line from clicks and a typed point, and Done writes one curve3d feature', async () => {
  const doc = parsePartDocument(readFileSync(new URL('../service/tests/fixtures/automation-part.part.json', import.meta.url), 'utf8'));
  const picks = [[0, 0, 0], [50, 0, 0]];
  const apply = vi.fn(async () => {});
  const shown = [];
  mount({ getDocument: () => doc, apply, pickPoint: () => ({ point: picks.shift() }), showCurves: (c) => shown.push(c), selection: () => [] });
  open();
  const viewport = document.querySelector('.cad-studio-viewport');
  const strip = document.querySelector('.cad-sketch3d-strip');
  expect(strip).toBeTruthy();
  const click = (x, y) => { viewport.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y })); viewport.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, clientX: x, clientY: y })); };
  click(10, 10); click(20, 20);
  // A drag orbits; it must not add a point.
  viewport.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }));
  viewport.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, clientX: 40, clientY: 40 }));
  const input = strip.querySelector('input[aria-label="Point x y z"]');
  input.value = '50 50 20';
  [...strip.querySelectorAll('button')].find((b) => b.textContent === 'Add').click();
  expect(shown.at(-1).at(-1).polylines[0]).toEqual([[0, 0, 0], [50, 0, 0], [50, 50, 20]]);
  [...strip.querySelectorAll('button')].find((b) => b.textContent === 'Done').click();
  await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
  const written = apply.mock.calls[0][0].features.filter((f) => f.type === 'curve3d');
  expect(written).toHaveLength(1);
  expect(written[0]).toMatchObject({ kind: 'line', pointsMillimeters: [[0, 0, 0], [50, 0, 0], [50, 50, 20]] });
  expect(document.querySelector('.cad-sketch3d-strip')).toBeNull();
});
