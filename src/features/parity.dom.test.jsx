/** Revolve and Mirror windows carry Onshape's controls (help: revolve.htm, PartStudio/mirror.htm);
 *  controls the kernel cannot honour are present, disabled and name the gap. */
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
const visible = (win, selector) => [...win.querySelectorAll(selector)].filter((el) => !el.closest('[hidden]'));
const tabs = (win) => [...win.querySelectorAll('.aui-feature-tabs, [role="tablist"]')].map((row) => [...row.querySelectorAll('button')].map((b) => b.textContent.trim()));

it('Revolve offers Merge scope for Add and Remove, and an Offset for the Up-to ends', async () => {
  cadCommands.execute('feature-revolve');
  const win = document.querySelector('.cad-feature-dialog');
  expect(tabs(win)).toEqual([['Solid', 'Surface', 'Thin'], ['New', 'Add', 'Remove', 'Intersect']]);
  [...win.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add').click();
  expect(visible(win, '.aui-feature-row').some((row) => row.textContent.includes('Merge with all'))).toBe(true);
  win.querySelector('[aria-label="Full revolve"]').click();
  const offset = win.querySelector('[aria-label^="Offset distance"]');
  expect(offset).toBeTruthy();
  expect(offset.closest('[aria-disabled="true"]')).toBeNull();
});

it("Mirror carries Onshape's type and result tabs, Entities to mirror, Mirror plane, Reapply features and Merge scope", async () => {
  cadCommands.execute('feature-mirror');
  const win = document.querySelector('.cad-feature-dialog');
  expect(tabs(win)).toEqual([['Part', 'Feature', 'Face'], ['New', 'Add', 'Remove', 'Intersect']]);
  const text = win.textContent;
  for (const label of ['Entities to mirror', 'Mirror plane', 'Reapply features', 'Merge scope']) expect(text).toContain(label);
  expect(visible(win, '.aui-feature-row').some((row) => row.textContent.includes('Target body'))).toBe(false);
  const gaps = [...win.querySelectorAll('[aria-disabled="true"]')].map((el) => el.textContent.trim());
  expect(gaps).toContain('Face');
  for (const real of ['Part', 'New', 'Intersect']) expect(gaps).not.toContain(real);
  [...win.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Remove').click();
  expect(win.querySelector('select[aria-label="Operation"]').value).toBe('cut');
  // Part mirror: the part box takes picks; New hides the merge scope.
  [...win.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Part').click();
  expect(win.querySelector('select[aria-label="Mirror"]').value).toBe('parts');
  [...win.querySelectorAll('button')].find((b) => b.textContent.trim() === 'New').click();
  expect(win.querySelector('.aui-feature-entities[aria-label^="Merge scope"]').hidden).toBe(true);
});

it("Draft shows Neutral plane / Parting line, Neutral plane, Entities to draft, Draft angle, Tangent propagation and Reapply fillets", async () => {
  cadCommands.execute('feature-draft');
  const win = document.querySelector('.cad-feature-dialog');
  expect(tabs(win)).toEqual([['Neutral plane', 'Parting line']]);
  const captions = [...win.querySelectorAll('.aui-feature-entities, .aui-feature-row')].filter((el) => !el.closest('[hidden]')).map((el) => el.firstElementChild?.textContent?.trim());
  const index = (label) => captions.findIndex((c) => c?.startsWith(label));
  expect(index('Neutral plane')).toBeGreaterThanOrEqual(0); expect(index('Neutral plane')).toBeLessThan(index('Entities to draft')); expect(index('Entities to draft')).toBeLessThan(index('Draft angle'));
  for (const label of ['Tangent propagation', 'Reapply fillets']) expect([...win.querySelectorAll('[aria-disabled="true"]')].some((el) => el.textContent.includes(label)), label).toBe(true);
  expect(captions.join(' | ')).not.toContain('Target body');
  // Parting line: the pull direction and parting entities boxes, the sides picker.
  [...win.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Parting line').click();
  expect(win.querySelector('select[aria-label="Draft mode"]').value).toBe('parting-line');
  const shown = [...win.querySelectorAll('.aui-feature-entities')].filter((el) => !el.hidden && !el.closest('[hidden]')).map((el) => el.getAttribute('aria-label'));
  expect(shown).toEqual(expect.arrayContaining(['Pull direction', 'Parting entities']));
  expect(shown).not.toContain('Entities to draft');
  expect(win.querySelector('[aria-label="Parting sides menu"]')).toBeTruthy();
});

it("Sweep shows Profile control, Twist, Scale, Trim ends and Merge scope after the path", async () => {
  cadCommands.execute('feature-sweep');
  const win = document.querySelector('.cad-feature-dialog');
  const text = win.textContent;
  for (const label of ['Faces and sketch regions to sweep', 'Sweep path', 'Profile control', 'Twist', 'Scale', 'Trim ends']) expect(text).toContain(label);
  // Twist is real; Trim ends stays the named gap.
  expect([...win.querySelectorAll('[aria-disabled="true"]')].some((el) => el.textContent.includes('Turns'))).toBe(false);
  expect([...win.querySelectorAll('[aria-disabled="true"]')].some((el) => el.textContent.includes('Trim ends'))).toBe(true);
  [...win.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add').click();
  expect(win.querySelector('.aui-feature-entities[aria-label^="Merge scope"]').closest('[hidden]')).toBeNull();
});

it("Split shows the Part / Face switch, Parts to split, Entity to split with, Keep tools, Trim to face boundaries and Keep both sides with its flip", async () => {
  cadCommands.execute('feature-split');
  const win = document.querySelector('.cad-feature-dialog');
  expect([...win.querySelector('select[aria-label="Split"]').options].map((o) => o.value)).toEqual(['part', 'face']);
  const text = win.textContent;
  for (const label of ['Parts to split', 'Entity to split with', 'Keep tools', 'Trim to face boundaries', 'Keep both sides']) expect(text).toContain(label);
  // Keep tools and Trim to face boundaries are real controls now (Trim shows once a face is the entity).
  expect(win.querySelector('[aria-label="Keep tools"]').closest('[aria-disabled="true"]')).toBeNull();
  win.querySelector('[aria-label="Keep both sides"]').click();
  expect(win.querySelector('[aria-label="Opposite direction"]').hidden).toBe(false);
});

it("Thread shows Standard, Size, Pitch or Threads per inch, End type with Length, Add chamfer, Add undercut and Split face", async () => {
  cadCommands.execute('feature-thread');
  const win = document.querySelector('.cad-feature-dialog');
  const text = win.textContent;
  for (const label of ['Cylindrical face', 'Standard', 'Size', 'Pitch', 'Thread class', 'End type', 'Add chamfer', 'Add undercut', 'Split face']) expect(text).toContain(label);
  // The chamfer, undercut and split face are real controls now.
  for (const label of ['Add chamfer', 'Add undercut', 'Split face']) expect([...win.querySelectorAll('[aria-disabled="true"]')].some((el) => el.textContent.includes(label)), label).toBe(false);
  const standard = win.querySelector('[aria-label="Standard"]'); standard.value = 'UNC (ASME B1.1)'; standard.dispatchEvent(new Event('change'));
  const size = win.querySelector('[aria-label="Size"]'); size.value = '1/4-20'; size.dispatchEvent(new Event('change'));
  expect(win.textContent).toContain('Threads per inch');
  expect(win.querySelector('[aria-label="Pitch"]').value).toBe('20');
  // Size from the cylinder's diameter is offered once a standard is chosen.
  expect(win.querySelector('[aria-label="Size from face"]')).toBeTruthy();
});

it("Rib shows Sketch profiles, Parts, Thickness, Rib direction with its flip, and names the parallel, draft and extend gaps", async () => {
  cadCommands.execute('feature-rib');
  const win = document.querySelector('.cad-feature-dialog');
  const text = win.textContent;
  for (const label of ['Sketch profiles', 'Parts', 'Thickness', 'Rib direction', 'Draft angle', 'Extend profiles to part', 'Merge ribs']) expect(text).toContain(label);
  expect(win.querySelector('[aria-label="Rib direction menu"]')).toBeTruthy();
  expect(win.querySelector('[aria-label="Opposite direction"]')).toBeTruthy();
  for (const label of ['Draft angle', 'Extend profiles to part']) expect([...win.querySelectorAll('[aria-disabled="true"]')].some((el) => el.textContent.includes(label)), label).toBe(true);
});

it("Enclose shows New / Add / Remove / Intersect, Entities, Keep tools and Merge scope", async () => {
  cadCommands.execute('feature-boundary-fill');
  const win = document.querySelector('.cad-feature-dialog');
  expect(tabs(win)).toEqual([['New', 'Add', 'Remove', 'Intersect']]);
  const text = win.textContent;
  for (const label of ['Entities', 'Cell points', 'Keep tools', 'Merge scope']) expect(text).toContain(label);
  expect(win.querySelector('.aui-feature-entities[aria-label^="Merge scope"]').hidden).toBe(true);
  [...win.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add').click();
  expect(win.querySelector('.aui-feature-entities[aria-label^="Merge scope"]').hidden).toBe(false);
});
