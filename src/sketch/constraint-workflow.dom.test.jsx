import { createRequire } from 'node:module';
import { beforeAll, beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument } from '@aether/core/document';
import { querySketchControl as q, clickSketchControl as click } from './test-controls';
import { cadCommands } from '../cad-command-registry';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom, open, doc, apply;
beforeAll(async () => {
  dom = new JSDOM('<div class="cad-studio-viewport"></div>', { url: 'http://localhost/cad/' });
  for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent', 'Event', 'location']) vi.stubGlobal(key, dom.window[key]);
  open = (await import('../sketch-workspace')).openSketchWorkspace;
}, 30000);
beforeEach(() => {
  document.body.innerHTML = '<div class="cad-studio-viewport"></div>';
  doc = createEmptyPartDocument('Constraint workflow');
  doc.features.push({ id: 'sketch', type: 'profile', name: 'Sketch 1', plane: 'XY', offsetMillimeters: 0, suppressed: false, profile: {
    type: 'drawing', contours: [4,6,8].map((radius, i) => ({ type: 'circle', center: [30 * i, 0], radius })),
    constraints: [{ id: 'radius', kind: 'radius', a: { contour: 0, kind: 'circle' }, value: 4 }],
  } });
  apply = vi.fn(async next => { doc = next; });
  open(() => doc, apply, doc.features[0]);
});
afterEach(() => { q('[aria-label="Cancel sketch"]')?.click(); });
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });
const command = name => window.dispatchEvent(new CustomEvent('aether-sketch-constraint', { detail: name }));
const toolName = () => document.querySelector('[aria-label="2D sketch canvas"]').dataset.constraintTool;
const key = (key, extra = {}) => document.querySelector('[aria-label="2D sketch canvas"]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, ...extra }));
function pick(x, y, ctrlKey = false) {
  const svg = q('[aria-label="2D sketch canvas"]');
  svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } });
  svg.getScreenCTM = () => ({ a: 1, b: 0, inverse: () => ({}) });
  svg.dispatchEvent(new dom.window.MouseEvent('click', { clientX: x, clientY: -y, ctrlKey, bubbles: true }));
}
const radii = () => [...document.querySelectorAll('circle.sketch-contour')].map(e => Number(e.getAttribute('r')));
const expectRadii = values => { expect(radii()).toHaveLength(values.length); radii().forEach((r,i) => expect(r).toBeCloseTo(values[i], 6)); };
async function finish(times) { click('Finish sketch'); await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(times)); doc = parsePartDocument(serializePartDocument(doc)); }

it('constrains three canvas-selected circles with one undo, preserves selection and survives dimension edits/reopen', async () => {
  pick(4,0); pick(36,0,true); pick(68,0,true); command('equal');
  expect(document.querySelector('.cad-sketch-workspace')?.textContent ?? document.body.textContent).toContain('applied to 3 selected entities');
  expectRadii([4,4,4]);
  expect(document.querySelector('[aria-label="Use selected geometry"]').checked).toBe(true);
  expect(document.querySelectorAll('.sketch-selection circle')).toHaveLength(3);
  command('equal'); // No redundant transaction: one Undo still removes the whole batch.
  click('Undo'); expectRadii([4,6,8]); click('Redo'); expectRadii([4,4,4]);
  await finish(1);
  expect(doc.features[0].profile.constraints.filter(c => c.kind === 'equal')).toHaveLength(2);
  open(() => doc, apply, doc.features[0]);
  const value = q('[aria-label="radius value"]'); value.value = '9';
  [...value.parentElement.querySelectorAll('button')].find(b => b.textContent === 'Update').click();
  expectRadii([9,9,9]); await finish(2);
  open(() => doc, apply, doc.features[0]); expectRadii([9,9,9]);
});
it('rejects incompatible driven circles without changing geometry or saved history', async () => {
  q('[aria-label="Cancel sketch"]').click();
  doc.features[0].profile.constraints.push({ id: 'other-radius', kind: 'radius', a: { contour: 1, kind: 'circle' }, value: 6 });
  const before = structuredClone(doc.features[0].profile);
  open(() => doc, apply, doc.features[0]);
  pick(4,0); pick(36,0,true); pick(68,0,true); command('equal');
  expectRadii([4,6,8]);
  await finish(1);
  expect(doc.features[0].profile.constraints).toEqual(before.constraints);
});

it('keeps a tool active for repeated pairs without modifier keys, with one undo per pair', async () => {
  command('equal'); expect(toolName()).toBe('equal');
  pick(4,0); expect(document.querySelectorAll('.sketch-selection circle')).toHaveLength(1);
  pick(36,0); expectRadii([4,4,8]); expect(toolName()).toBe('equal');
  expect(document.querySelectorAll('.sketch-selection circle')).toHaveLength(0);
  pick(34,0); pick(68,0); expectRadii([4,4,4]);
  click('Undo'); expectRadii([4,4,8]); expect(toolName()).toBe('equal');
  click('Undo'); expectRadii([4,6,8]); click('Redo'); expectRadii([4,4,8]);
  key('Escape'); expect(toolName()).toBe('');
  await finish(1); expect(doc.features[0].profile.constraints.filter(c => c.kind === 'equal')).toHaveLength(1);
  open(() => doc, apply, doc.features[0]); expectRadii([4,4,8]); expect(toolName() || '').toBe('');
});

it('toggles the same command off, switches constraints and clears unfinished picks on undo', () => {
  command('equal'); pick(4,0);
  command('equal'); expect(toolName()).toBe('');
  command('equal'); pick(4,0); command('concentric'); expect(toolName()).toBe('concentric');
  key('Escape'); command('equal'); pick(4,0); click('Undo');
  pick(36,0); expectRadii([4,6,8]); // No stale first pick was applied by undo.
  window.dispatchEvent(new CustomEvent('aether-sketch-tool', { detail: 'line' }));
  expect(toolName()).toBe('');
});

it('uses an incomplete preselection as the first pick and lets blank space reset it', () => {
  pick(4,0); command('equal'); expect(toolName()).toBe('equal');
  pick(36,0); expectRadii([4,4,8]);
  pick(4,0); pick(200,200); pick(68,0); expectRadii([4,4,8]);
  pick(34,0); expectRadii([4,4,4]);
});

it('retains the first pick after a conflicting second pick and accepts a different target', async () => {
  q('[aria-label="Cancel sketch"]').click();
  doc.features[0].profile.constraints.push({ id: 'other-radius', kind: 'radius', a: { contour: 1, kind: 'circle' }, value: 6 });
  open(() => doc, apply, doc.features[0]);
  command('equal'); pick(4,0); pick(36,0); expectRadii([4,6,8]);
  expect(document.querySelectorAll('.sketch-selection circle')).toHaveLength(1);
  pick(68,0); expectRadii([4,6,4]);
  await finish(1); expect(doc.features[0].profile.constraints.filter(c => c.kind === 'equal')).toHaveLength(1);
});

it('stops tool-first picking when the shared editor is closed or switched', () => {
  command('equal'); pick(4,0);
  expect(document.querySelector('[aria-label="Sketch editor"]')).toBeNull();
  cadCommands.execute('sketch-constraints');
  expect(toolName()).toBe('');
  const selector = document.querySelector('[aria-label="Sketch editor"]');
  selector.value = 'coordinates'; selector.dispatchEvent(new Event('change'));
  expect(toolName()).toBe('');
  command('parallel'); cadCommands.execute('sketch-coordinates');
  expect(toolName()).toBe('');
});

it.each(['idle','equal'])('hands every closed region to the next solid feature after finishing with %s tool state', async state => {
  const { takePickedSketchRegion } = await import('../sketch-region-selection');
  takePickedSketchRegion();
  if (state === 'equal') { command('equal'); pick(4,0); pick(36,0); }
  await finish(1);
  expect(takePickedSketchRegion()).toEqual({featureId:'sketch',contourIndex:0,contourIndices:[0,1,2]});
  expect(takePickedSketchRegion()).toBeNull();
});

it('fixes whole canvas curves, persists the lock and unfixes selection with one undo', async () => {
  pick(36,0); command('fix');
  expectRadii([4,6,8]);
  await finish(1);
  expect(doc.features[0].profile.constraints.filter(c => c.kind === 'fix')).toHaveLength(1);
  expect(doc.features[0].profile.constraints.find(c => c.kind === 'fix').fixedGeometry).toMatchObject({ type: 'circle', radius: 6 });
  open(() => doc, apply, doc.features[0]);
  pick(36,0); expect(cadCommands.snapshot()['sketch-unfix'].enabled).toBe(true);
  cadCommands.execute('sketch-unfix'); expect(cadCommands.snapshot()['sketch-unfix'].enabled).toBe(false);
  click('Undo'); pick(36,0); expect(cadCommands.snapshot()['sketch-unfix'].enabled).toBe(true);
  click('Redo'); expect(cadCommands.snapshot()['sketch-unfix'].enabled).toBe(false);
  await finish(2);
  expect(doc.features[0].profile.constraints.filter(c => c.kind === 'fix')).toHaveLength(0);
  expect(doc.features[0].profile.constraints.find(c => c.id === 'radius')).toBeTruthy();
  open(() => doc, apply, doc.features[0]);
  command('fix'); pick(36,0); key('Escape');
  click('Undo'); await finish(3);
  expect(doc.features[0].profile.constraints.filter(c => c.kind === 'fix')).toHaveLength(0);
});

it('uses the shared explicit entity editor for curve Fix and allows Unfix from its selected badge', async () => {
  cadCommands.execute('sketch-constraints');
  const kind=q('[aria-label="Constraint"]');kind.value='fix';kind.dispatchEvent(new Event('change'));
  const entity=q('[aria-label="Entity A"]');
  entity.value=[...entity.options].find(option=>{ const ref=JSON.parse(option.value);return ref.kind==='circle' && ref.contour===2; }).value;
  entity.dispatchEvent(new Event('change'));click('Apply constraint');
  expect(document.querySelectorAll('[data-constraint-mark="fix"]')).toHaveLength(1);
  pick(200,200);
  document.querySelector('[data-constraint-mark="fix"]').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));
  expect(cadCommands.snapshot()['sketch-unfix'].enabled).toBe(true);
  cadCommands.execute('sketch-unfix');
  expect(document.querySelectorAll('[data-constraint-mark="fix"]')).toHaveLength(0);
  click('Undo');expect(document.querySelectorAll('[data-constraint-mark="fix"]')).toHaveLength(1);
  await finish(1);
  expect(doc.features[0].profile.constraints.find(c=>c.kind==='fix').fixedGeometry).toMatchObject({type:'circle',radius:8});
});
