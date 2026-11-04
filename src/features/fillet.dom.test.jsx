import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { parsePartDocument } from '@aether/core/document';
import { cadCommands } from '../cad-command-registry';

const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom, doc, apply;
beforeAll(async () => {
  dom = new JSDOM('<!doctype html><body><div class="cad-studio-viewport"></div></body>', { url: 'http://localhost/cad/' });
  for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent', 'Event', 'location']) vi.stubGlobal(key, dom.window[key]);
  doc = parsePartDocument(readFileSync(new URL('../../service/tests/fixtures/automation-part.part.json', import.meta.url), 'utf8'));
  apply = vi.fn(async (next) => { doc = next; });
  (await import('../feature-authoring')).mountFeatureAuthoring(() => doc, apply);
});
afterEach(async () => {
  document.querySelectorAll('[data-feature-action="discard"]').forEach((button) => button.click());
  await new Promise((resolve) => setTimeout(resolve, 30));
});
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });

/** Visible captions in document order: entity boxes, parameter rows and sub-setting headers. */
const captions = (win) => [...win.querySelectorAll('*')]
  .filter((el) => !el.closest('[hidden]'))
  .filter((el) => el.matches('.aui-feature-entities, .aui-feature-row, [class*="subsection"]'))
  .map((el) => el.firstElementChild?.textContent?.trim() ?? '');

it("Fillet carries Onshape's Edge controls in order, names each kernel gap, and has no Target body", async () => {
  cadCommands.execute('feature-fillet');
  const win = document.querySelector('.cad-feature-dialog');
  expect([...win.querySelectorAll('.aui-feature-tabs button, [role="tablist"] button')].map((b) => b.textContent.trim())).toEqual(['Edge', 'Full round']);
  const seen = captions(win).join(' | ');
  for (const expected of ['Entities to fillet', 'Tangent propagation', 'Measurement', 'Control', 'Radius', 'Asymmetric', 'Partial fillet', 'Variable fillet', 'Allow edge overflow', 'Smooth fillet corners']) expect(seen).toContain(expected);
  expect(seen).not.toContain('Target body');
  // The Entities box takes the picks on the Edge tab, not the Full round face boxes mounted after it.
  expect(win.querySelector('.aui-feature-entities[aria-label^="Entities to fillet"]').dataset.picking).toBe('true');
  expect(win.querySelector('.aui-feature-entities[aria-label^="Side face"]').dataset.picking).toBe('false');
  const index = (label) => captions(win).findIndex((c) => c.startsWith(label));
  expect(index('Measurement')).toBeLessThan(index('Control')); expect(index('Control')).toBeLessThan(index('Radius'));
  expect(index('Asymmetric')).toBeLessThan(index('Partial fillet')); expect(index('Variable fillet')).toBeLessThan(index('Allow edge overflow'));
  // Gaps are present, disabled and explained; nothing is silently inert.
  const gaps = [...win.querySelectorAll('[aria-disabled="true"]')];
  expect(gaps.length).toBeGreaterThanOrEqual(5);
  for (const gap of gaps) expect(gap.title).toMatch(/kernel/);
  // Choosing Conic refuses with the gap named, never a silent circular fillet.
  const control = win.querySelector('select[aria-label="Control"]');
  control.value = 'conic'; control.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(win.textContent).toMatch(/Conic and Curvature control/));
});

it('Fillet Full round shows Side face, Opposite side face, Faces to replace and Tangent propagation', async () => {
  cadCommands.execute('feature-fillet');
  const win = document.querySelector('.cad-feature-dialog');
  [...win.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Full round').click();
  expect(win.querySelector('select[aria-label="Fillet type"]').value).toBe('full-round');
  expect(captions(win).slice(0, 4)).toEqual(['Side face', 'Opposite side face', 'Faces to replace', 'Tangent propagation']);
  await vi.waitFor(() => expect(win.textContent).toContain('Select the side face.'));
});
