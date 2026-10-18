import { createRequire } from 'node:module';
import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument } from '@aether/core/document';
import { applyDocumentUnits } from '../document-preferences';
import { clickSketchControl as click, querySketchControl as q } from './test-controls';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom, open;
beforeAll(async () => {
  dom = new JSDOM('<div class="cad-studio-viewport"></div>', { url: 'http://localhost/cad/' });
  for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent', 'Event', 'location']) vi.stubGlobal(key, dom.window[key]);
  open = (await import('../sketch-workspace')).openSketchWorkspace;
});
afterEach(() => { if (q('.cad-sketch-workspace')) click('Cancel'); applyDocumentUnits({}); });
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });
const tool = name => window.dispatchEvent(new CustomEvent('aether-sketch-tool', { detail: name }));
const point = (x, y) => { q('[aria-label="X (mm)"]').value = x; q('[aria-label="Y (mm)"]').value = y; click('Place point'); };
function setup() {
  let doc = createEmptyPartDocument('Conic');
  const apply = vi.fn(async next => { doc = next; });
  open(() => doc, apply); click('Top (XY)'); tool('conic');
  const svg = q('[aria-label="2D sketch canvas"]');
  svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } });
  svg.getScreenCTM = () => ({ a: 1, b: 0, inverse: () => ({}) });
  const pointer = (type, x, y, opts = {}) => {
    const event = new dom.window.MouseEvent(type, { clientX: x, clientY: -y, button: 0, bubbles: true, altKey: true, ...opts });
    Object.defineProperty(event, 'pointerId', { value: 1 }); svg.dispatchEvent(event);
  };
  const save = async () => { click('Finish sketch'); await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce()); return parsePartDocument(serializePartDocument(doc)); };
  return { svg, pointer, apply, save, doc: () => doc };
}
it('creates an exact four-point conic with matching preview, a real control node, rho annotation and undo/save/reopen', async () => {
  const t = setup();
  point(0, 0); point(20, 0); point(10, 20);
  expect(q('.sketch-contour')).toBeNull();
  t.pointer('pointermove', 10, 14);
  const preview = q('[data-conic-preview]').getAttribute('d');
  point(10, 14);
  expect(q('.sketch-contour').getAttribute('d')).toBe(preview);
  expect(q('[data-node-control="0"]')).not.toBeNull();
  expect(q('.sketch-dimension').textContent).toContain('0.7');
  click('Undo'); expect(q('.sketch-contour')).toBeNull(); click('Redo');
  const saved = await t.save(), profile = saved.features[0].profile;
  expect(saved.formatVersion).toBe(21);
  expect(profile.contours[0]).toMatchObject({ start: [0, 0], segments: [{ type: 'conic', end: [20, 0], control: [10, 20], rho: .7 }] });
  expect(profile.constraints.filter(c => c.kind === 'conic-rho')).toMatchObject([{ value: .7 }]);
  open(() => saved, t.apply, saved.features[0]); expect(q('.sketch-contour').getAttribute('d')).toBe(preview);
});
it('uses scalar formulas before placement and keeps rho unchanged by inch/radian display units', async () => {
  const t = setup(), input = q('[aria-label="Conic rho"]');
  input.value = '3/5'; input.dispatchEvent(new Event('input'));
  applyDocumentUnits({ length: { unit: 'in', decimals: 3 }, angle: { unit: 'rad', decimals: 3 } });
  point(0, 0); point(20, 0); point(10, 20);
  expect(q('.sketch-dimension').textContent).toContain('0.6');
  expect(q('.sketch-dimension').textContent).not.toMatch(/in|mm/);
  const saved = await t.save();
  expect(saved.features[0].profile.contours[0].segments[0].rho).toBe(.6);
  expect(saved.features[0].profile.constraints).toMatchObject([{ kind: 'conic-rho', value: .6, valueExpression: '3/5' }]);
});
it('edits the existing rho driver from a curve pick without creating a duplicate dimension', async () => {
  const t = setup(); point(0, 0); point(20, 0); point(10, 20); point(10, 10);
  tool('select');
  window.dispatchEvent(new CustomEvent('aether-sketch-constraint', { detail: 'distance' }));
  expect(t.svg.dataset.dimensionTool).toBe('active');
  t.pointer('click', 5, 7.5); t.pointer('click', 30, 25);
  const panel = q('.cad-sketch-dimension-entry'); expect(panel, q('.cad-sketch-workspace').textContent).not.toBeNull();
  expect(panel.querySelector('input').value).toBe('0.5');
  applyDocumentUnits({ length: { unit: 'in', decimals: 3 } });
  panel.querySelector('input').value = '0.8'; panel.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(q('.cad-sketch-dimension-entry')).toBeNull();
  const saved = await t.save();
  expect(saved.features[0].profile.constraints.filter(c => c.kind === 'conic-rho')).toHaveLength(1);
  expect(saved.features[0].profile.contours[0].segments[0].rho).toBeCloseTo(.8, 6);
});
it('drags the actual tangent node, cancels an in-flight drag and restores one completed drag with undo', async () => {
  const t = setup(); point(0, 0); point(20, 0); point(10, 20); point(10, 10); tool('select');
  const node = () => q('[data-node-control="0"]');
  t.pointer('pointerdown', 10, 20); t.pointer('pointermove', 14, 26); t.pointer('pointercancel', 14, 26);
  expect(Number(node().getAttribute('cx'))).toBe(10);
  t.pointer('pointerdown', 10, 20); t.pointer('pointermove', 14, 26); t.pointer('pointerup', 14, 26);
  expect(Number(node().getAttribute('cx'))).toBe(14);
  click('Undo'); expect(Number(node().getAttribute('cx'))).toBe(10); click('Redo');
  const saved = await t.save(); expect(saved.features[0].profile.contours[0].segments[0]).toMatchObject({ control: [14, 26], rho: .5 });
});
it('rejects invalid scalar input atomically and lets the unfinished gesture be corrected or cancelled', () => {
  const t = setup(), input = q('[aria-label="Conic rho"]');
  point(0, 0); point(20, 0);
  for (const value of ['1', '0', '1 mm', '#missing']) {
    input.value = value; input.dispatchEvent(new Event('input')); point(10, 20);
    expect(input.getAttribute('aria-invalid')).toBe('true'); expect(q('.sketch-contour')).toBeNull();
  }
  input.value = '.5'; input.dispatchEvent(new Event('input')); point(10, 20); expect(q('.sketch-contour')).not.toBeNull();
  click('Cancel'); expect(t.apply).not.toHaveBeenCalled(); expect(t.doc().features).toHaveLength(0);
});

it('automatically opens rho entry after the control point and Enter commits the preview without closing the tool', async () => {
  const t = setup(); point(0, 0); point(20, 0); point(10, 20);
  const input = q('[aria-label="Conic rho"]');
  expect(document.activeElement).toBe(input); expect(input.value).toBe('0.5');
  expect(q('[data-conic-preview]')).not.toBeNull();
  input.value = '.65'; input.dispatchEvent(new Event('input'));
  const preview = q('[data-conic-preview]').getAttribute('d');
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  expect(q('.sketch-contour').getAttribute('d')).toBe(preview); expect(q('.cad-sketch-workspace')).not.toBeNull();
  expect(t.apply).not.toHaveBeenCalled(); expect(input.value).toBe('');
  click('Undo'); expect(q('.sketch-contour')).toBeNull(); click('Redo');
  const saved = await t.save(); expect(saved.features[0].profile.constraints[0]).toMatchObject({ kind: 'conic-rho', value: .65 });
  expect(saved.features[0].profile.constraints[0].valueExpression).toBeUndefined();
});
it('accepts the default parabola on Enter and offers a fresh rho value for the next curve', async () => {
  const t = setup(); point(0, 0); point(20, 0); point(10, 20);
  q('[aria-label="Conic rho"]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  point(40, 0); point(60, 0); point(50, 20);
  expect(document.activeElement).toBe(q('[aria-label="Conic rho"]')); expect(q('.sketch-contour')).not.toBeNull();
  q('[aria-label="Conic rho"]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const saved = await t.save(); expect(saved.features[0].profile.contours).toHaveLength(2);
  expect(saved.features[0].profile.constraints.filter(c => c.kind === 'conic-rho').map(c => c.value)).toEqual([.5, .5]);
});
it('starts keyboard rho entry after endpoints and accepts a formula before the control point', async () => {
  const t = setup(); point(0, 0); point(20, 0); t.svg.focus();
  t.svg.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: '=', bubbles: true, cancelable: true }));
  const input = q('[aria-label="Conic rho"]'); expect(document.activeElement).toBe(input); expect(input.value).toBe('=');
  input.value = '=3/5'; input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  expect(q('.sketch-contour')).toBeNull(); point(10, 20);
  const saved = await t.save(); expect(saved.features[0].profile.constraints[0]).toMatchObject({ value: .6, valueExpression: '3/5' });
});
it('retains invalid automatic entry for correction, and Escape cancels the pending curve', () => {
  const t = setup(); point(0, 0); point(20, 0); point(10, 20);
  const input = q('[aria-label="Conic rho"]'); input.value = '1'; input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  expect(q('.sketch-contour')).toBeNull(); expect(document.activeElement).toBe(input); expect(input.getAttribute('aria-invalid')).toBe('true');
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(q('[data-conic-preview]')).toBeNull(); expect(q('.sketch-contour')).toBeNull(); expect(t.apply).not.toHaveBeenCalled();
});

it('retains the last pointer curvature when leaving the canvas to confirm the field', async () => {
  const t = setup(); point(0, 0); point(20, 0); point(10, 20); t.pointer('pointermove', 10, 14);
  const preview = q('[data-conic-preview]').getAttribute('d'); expect(q('[aria-label="Conic rho"]').value).toBe('0.7');
  t.pointer('pointerleave', 10, 14); expect(q('[data-conic-preview]').getAttribute('d')).toBe(preview);
  q('[aria-label="Conic rho"]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  expect(q('.sketch-contour').getAttribute('d')).toBe(preview);
  const saved = await t.save(); expect(saved.features[0].profile.constraints[0].value).toBe(.7);
});

it('rejects a collinear control before opening rho and lets the next click correct it', async () => {
  const t = setup(); point(0, 0); point(20, 0); point(10, 0);
  expect(q('[data-conic-preview]')).toBeNull(); expect(q('.sketch-contour')).toBeNull();
  point(10, 20); expect(q('[data-conic-preview]')).not.toBeNull();
  q('[aria-label="Conic rho"]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const saved = await t.save(); expect(saved.features[0].profile.contours[0].segments[0]).toMatchObject({ control: [10, 20], rho: .5 });
});
