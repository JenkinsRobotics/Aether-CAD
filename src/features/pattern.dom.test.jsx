/** The Pattern window carries Onshape's Linear and Circular controls (help: PartStudio/linear_pattern.htm, circular_pattern.htm). */
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
const captions = (win) => [...win.querySelectorAll('.aui-feature-entities, .aui-feature-row, [class*="subsection"]')].filter((el) => !el.closest('[hidden]')).map((el) => el.firstElementChild?.textContent?.trim() ?? '');
const tabs = (win) => [...win.querySelectorAll('.aui-feature-tabs, [role="tablist"]')].map((row) => [...row.querySelectorAll('button')].map((b) => b.textContent.trim()));

it("Pattern shows Linear's Direction, Distance, Instance count, Centered and Second direction, then Circular's Axis, Angle and Equal spacing", async () => {
  cadCommands.execute('feature-pattern');
  const win = document.querySelector('.cad-feature-dialog');
  expect(tabs(win)).toEqual([['Linear', 'Circular', 'Curve'], ['Part', 'Feature', 'Face'], ['New', 'Add', 'Remove', 'Intersect']]);
  let seen = captions(win).join(' | ');
  for (const label of ['Entities to pattern', 'Direction', 'Distance', 'Instance count', 'Centered', 'Second direction', 'Skip instances', 'Reapply features', 'Merge scope']) expect(seen).toContain(label);
  expect(seen).not.toContain('Target body');
  const gaps = [...win.querySelectorAll('[aria-disabled="true"]')].map((el) => el.textContent.trim());
  expect(gaps).toEqual(expect.arrayContaining(['Face', 'Add', 'Remove', 'Intersect']));
  [...win.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Circular').click();
  expect(win.querySelector('select[aria-label="Pattern type"]').value).toBe('polar');
  seen = captions(win).join(' | ');
  for (const label of ['Axis of pattern', 'Angle', 'Instance count', 'Equal spacing', 'Centered']) expect(seen).toContain(label);
  expect(seen).not.toContain('Distance |');
  // Equal spacing off: the typed angle is between instances; the document stores the total extent.
  const control = (prefix) => { const el = win.querySelector(`[aria-label^="${prefix}"]`); expect(el, prefix).toBeTruthy(); return el; };
  control('Source feature').value = doc.features.find((f) => f.type === 'extrude').id; control('Source feature').dispatchEvent(new Event('change'));
  control('Equal spacing').click();
  control('Angle (').value = '30'; control('Angle (').dispatchEvent(new Event('change'));
  control('Instance count').value = '4'; control('Instance count').dispatchEvent(new Event('change'));
  win.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
  expect(doc.features.at(-1)).toMatchObject({ type: 'pattern', patternType: 'polar', count: 4, angleDegrees: 90 });
});
