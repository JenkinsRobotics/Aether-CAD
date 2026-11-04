/** The Hole window carries Onshape's controls in order (help: hole.htm); kernel gaps refuse with the gap named. */
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
const captions = (win) => [...win.querySelectorAll('.aui-feature-entities, .aui-feature-row')].filter((el) => !el.closest('[hidden]')).map((el) => el.firstElementChild?.textContent?.trim() ?? '');

it("Hole opens on Metric / Inch and Simple / Counterbore / Countersink with Onshape's rows in order", async () => {
  cadCommands.execute('feature-hole');
  const win = document.querySelector('.cad-feature-dialog');
  const tabs = [...win.querySelectorAll('.aui-feature-tabs, [role="tablist"]')].map((row) => [...row.querySelectorAll('button')].map((b) => b.textContent.trim()));
  expect(tabs).toEqual([['Metric', 'Inch'], ['Simple', 'Counterbore', 'Countersink']]);
  const seen = captions(win);
  const order = ['Sketch points to place holes', 'Merge scope', 'Hole type', 'Diameter', 'Start plane', 'Termination', 'Depth', 'Tip angle style'];
  const indexes = order.map((label) => seen.findIndex((c) => c.startsWith(label)));
  for (const [i, label] of order.entries()) expect(indexes[i], label).toBeGreaterThanOrEqual(0);
  expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  expect(seen.join(' | ')).not.toContain('Target body');
  // A standard drives the diameter for a Clearance hole; PEM names the kernel gap.
  const type = win.querySelector('select[aria-label="Hole type"]');
  type.value = 'clearance'; type.dispatchEvent(new Event('change'));
  expect(win.querySelector('[aria-label="Diameter (mm)"]').readOnly).toBe(true);
  type.value = 'pem'; type.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(win.textContent).toMatch(/PEM/));
  // Placing a hole at a sketch point and applying stores Onshape's placement.
  type.value = 'drilled'; type.dispatchEvent(new Event('change'));
  const list = win.querySelector('select[aria-label="Sketch points to place holes sketch point"]');
  const option = [...list.options].find((o) => o.value);
  expect(option, 'a sketch point of an earlier sketch').toBeTruthy();
  list.value = option.value; list.dispatchEvent(new Event('change'));
  expect(win.querySelector('.aui-feature-entities[aria-label^="Sketch points"]').textContent).toContain(option.textContent.trim());
  win.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
  expect(doc.features.at(-1)).toMatchObject({ type: 'hole', placement: { kind: 'sketch-points' } });
  expect(doc.features.at(-1).placement.points[0].kind).toBe('sketch-point');
});
