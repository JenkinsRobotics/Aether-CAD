import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { parsePartDocument } from '@aether/core/document';
import { cadCommands } from '../cad-command-registry';
import { cadSelection } from '../cad-selection-store';
import { availableBodies } from '@aether/core/document';

const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom, doc, apply;
beforeAll(async () => {
  dom = new JSDOM('<!doctype html><body><div class="cad-studio-viewport"></div></body>', { url: 'http://localhost/cad/' });
  for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent', 'Event', 'location']) vi.stubGlobal(key, dom.window[key]);
  doc = parsePartDocument(readFileSync(new URL('../../service/tests/fixtures/automation-part.part.json', import.meta.url), 'utf8'));
  doc.features.push({ ...doc.features[1], id: 'second-pad', name: 'Second body' });
  apply = vi.fn(async (next) => { doc = next; });
  (await import('../feature-authoring')).mountFeatureAuthoring(() => doc, apply);
});
afterEach(async () => {
  document.querySelectorAll('[data-feature-action="discard"]').forEach((button) => button.click());
  await new Promise((resolve) => setTimeout(resolve, 30)); // shared controls unmount on the next task
});
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });

it('Boolean opens on Union/Subtract/Intersect tabs with the tool bodies right under them', async () => {
  cadCommands.execute('feature-boolean');
  const win = document.querySelector('.cad-feature-dialog');
  const tabs = [...win.querySelectorAll('.aui-feature-tabs button, [role="tablist"] button')].map((b) => b.textContent.trim());
  expect(tabs).toEqual(['Union', 'Subtract', 'Intersect']);
  const order = [...win.querySelectorAll('.aui-feature-tabs, [role="tablist"], .aui-feature-entities, .aui-feature-row')].map((el) => el.className.split(' ')[0]);
  expect(order.indexOf('aui-feature-entities')).toBeLessThan(order.findIndex((c) => c === 'aui-feature-row'));
  [...win.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Subtract').click();
  expect(win.querySelector('select[aria-label="Operation"]').value).toBe('cut');
  // Picking a part in the viewport fills the Tools box; the target is excluded.
  const tool = availableBodies(doc).find((body) => body.id !== win.querySelector('[aria-label="Target body"]').value);
  cadSelection.dispatch({ type: 'replace', items: [{ id: 'pick', kind: 'face', partId: tool.id, label: 'Face' }] });
  expect(win.querySelector('.aui-feature-entities[aria-label^="Tools"]').textContent).toContain(tool.name);
  win.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
  expect(doc.features.at(-1)).toMatchObject({ type: 'boolean', operation: 'cut' });
});
