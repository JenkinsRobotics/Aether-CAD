import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { parsePartDocument } from '@aether/core/document';

const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom, open;
beforeAll(async () => {
  dom = new JSDOM('<!doctype html><body><div class="cad-studio-viewport"></div></body>', { url: 'http://localhost/cad/' });
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLSelectElement', 'CustomEvent', 'Event', 'Option', 'location'])
    vi.stubGlobal(key, dom.window[key]);
  open = (await import('./derived-curves-window')).openDerivedCurveWindow;
});
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });

it('is one window whose Curve row switches the kind', async () => {
  const doc = parsePartDocument(readFileSync(new URL('../service/tests/fixtures/automation-part.part.json', import.meta.url), 'utf8'));
  const deps = { getDocument: () => doc, apply: async () => {}, selection: () => [], showCurves: () => {} };
  open('intersection_curve', deps);
  const kind = () => document.querySelector('.cad-derived-curve-window select[aria-label="Curve"]');
  expect(kind().value).toBe('intersection_curve');
  expect(document.querySelector('.cad-derived-curve-window select[aria-label="Curve direction"]')).toBeNull();
  kind().value = 'isoparametric_curve';
  kind().dispatchEvent(new Event('change'));
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(document.querySelectorAll('.cad-derived-curve-window')).toHaveLength(1);
  expect(kind().value).toBe('isoparametric_curve');
  expect(document.querySelector('.cad-derived-curve-window select[aria-label="Curve direction"]')).toBeTruthy();
});
