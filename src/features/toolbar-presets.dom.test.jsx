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

it.each([
  ['feature-union', 'union'],
  ['feature-subtract', 'cut'],
  ['feature-intersect', 'intersection'],
])('%s commits the requested operation through the canonical Boolean editor', async (command, operation) => {
  cadCommands.execute(command);
  expect(control('Operation').value).toBe(operation);
  const checkbox = document.querySelector('input[aria-label^="Use "]');
  checkbox.click();
  document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
  expect(doc.features.at(-1)).toMatchObject({ type: 'boolean', operation, keepTools: false });
  expect(doc.features.at(-1).toolBodyIds).toHaveLength(1);
  expect(doc.features.at(-1).targetBodyId).not.toBe(doc.features.at(-1).toolBodyIds[0]);
});

it('Replace Face starts with target-face replacement and Cancel preserves the document', () => {
  const before = structuredClone(doc);
  cadCommands.execute('feature-replace-face');
  expect(control('Replace with plane').value).toBe('yes');
  expect(control('Plane source').value).toBe('face');
  expect(document.querySelector('.cad-feature-dialog').textContent).toContain('Replace Face');
  document.querySelector('[data-feature-action="discard"]').click();
  expect(apply).not.toHaveBeenCalled();
  expect(doc).toEqual(before);
  cadCommands.execute('feature-offset-face');
  expect(control('Replace with plane').value).toBe('no');
  expect(control('Face operation').value).toBe('offset');
});
