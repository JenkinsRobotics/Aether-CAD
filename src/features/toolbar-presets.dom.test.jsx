import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { parsePartDocument } from '@aether/core/document';
import { cadCommands } from '../cad-command-registry';

const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom, mount, doc, apply;
const control = label => document.querySelector(`[aria-label="${label}"]`);
beforeAll(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/cad/' });
  for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent', 'Event', 'location'])
    vi.stubGlobal(key, dom.window[key]);
  mount = (await import('../feature-authoring')).mountFeatureAuthoring;
});
beforeEach(() => {
  document.body.innerHTML = '<div class="cad-studio-viewport"></div>';
  doc = parsePartDocument(readFileSync(new URL('../../service/tests/fixtures/automation-part.acpart', import.meta.url), 'utf8'));
  doc.features.push({ ...doc.features[1], id: 'second-pad', name: 'Second body' });
  apply = vi.fn(async next => { doc = next; });
  mount(() => doc, apply);
});
afterEach(async () => {
  document.querySelectorAll('[data-feature-action="discard"]').forEach(button => button.click());
  // Shared controls unmount their React roots on the next task.
  await new Promise(resolve => setTimeout(resolve, 20));
});
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });

it('Offset Face opens on offsetting and Cancel preserves the document', () => {
  const before = structuredClone(doc);
  cadCommands.execute('feature-offset-face');
  expect(control('Replace with plane').value).toBe('no');
  expect(control('Face operation').value).toBe('offset');
  document.querySelector('[data-feature-action="discard"]').click();
  expect(apply).not.toHaveBeenCalled();
  expect(doc).toEqual(before);
});

it('Split is one feature: its first row switches between Part and Face', async () => {
  cadCommands.execute('feature-split');
  expect(control('Split').value).toBe('part');
  expect(control('Part to split')).toBeTruthy();
  control('Split').value = 'face';
  control('Split').dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(control('Faces to split')).toBeTruthy());
  expect(document.querySelectorAll('.cad-feature-dialog')).toHaveLength(1);
  expect(control('Split').value).toBe('face');
});
