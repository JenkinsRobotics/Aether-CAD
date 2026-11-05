import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createEmptyPartDocument } from '@aether/core/document';
import { cadSelection } from '../cad-selection-store';
import { cadWorkspace } from '../cad-workspace-store';
import { extrudeDirectionControls, layoutExtrudeDirection, serializeExtrudeDirection, validateExtrudeDirection } from './extrude-direction';
import type { FeatureEditorContext } from './shared';

const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom: any;
let close: (() => void) | undefined;
let respond: EventListener;
let respondFace: EventListener;
const edge = { kind: 'solid-edge', sourceFeatureId: 'guide', bodyId: 'guide-body', label: 'Guide edge',
  anchor: { start: { signature: 'a', positionMillimeters: [0, 0, 0] }, end: { signature: 'b', positionMillimeters: [3, 0, 4] } } };
const axis = { kind: 'axis', sourceFeatureId: 'axis', label: 'Axis' };
const item = { id: 'edge', kind: 'edge' as const, partId: 'guide-body', label: 'Guide edge' };
const click = () => window.dispatchEvent(new CustomEvent('aether-feature-reference-click', { cancelable: true, detail: { item } }));
beforeAll(() => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/cad/' });
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'CustomEvent', 'Event', 'location']) vi.stubGlobal(key, dom.window[key]);
});
afterEach(async () => {
  close?.(); window.removeEventListener('aether-transform-edge-request', respond);
  window.removeEventListener('aether-extrude-direction-face-request', respondFace);
  await new Promise(resolve => setTimeout(resolve, 0)); cadSelection.dispatch({ type: 'clear' });
  cadWorkspace.publish({ ...cadWorkspace.snapshot(), selectedItemIDs: new Set() });
});
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });

async function mount(reference?: typeof axis | typeof edge) {
  const { openFeatureWindow } = await import('@aether/ui');
  const win = openFeatureWindow({ viewport: document.body, title: 'Extrude', className: 'direction-test', acceptLabel: 'Apply', discardLabel: 'Cancel', onAccept() {}, onDiscard() {} });
  close = win.close;
  const form = document.createElement('form'); form.id = 'direction-test-form'; win.body.append(form);
  const doc = createEmptyPartDocument('Direction');
  doc.features = [{ id: 'axis', type: 'axis', name: 'Axis' }, { id: 'suppressed', type: 'axis', name: 'Suppressed', suppressed: true },
    { id: 'edit', type: 'extrude', name: 'Extrude', directionReference: reference }, { id: 'later', type: 'axis', name: 'Later' }] as any;
  const context = { win, form, doc, feature: doc.features[2], field(name: string, value: string, options?: string[]) {
    const control = document.createElement(options ? 'select' : 'input'); control.setAttribute('aria-label', name);
    options?.forEach(value => { const option = document.createElement('option'); option.value = value; control.append(option); });
    control.value = value; form.append(control); return control;
  } } as FeatureEditorContext;
  const controls = extrudeDirectionControls(context); layoutExtrudeDirection(context, controls, win.body);
  const mode = (value: string) => { controls.directionMode.value = value; controls.directionMode.dispatchEvent(new Event('change')); };
  respond = event => {
    expect((event as CustomEvent).detail.selection).toEqual([item]);
    window.dispatchEvent(new CustomEvent('aether-transform-edge', { detail: { reference: edge } }));
  };
  window.addEventListener('aether-transform-edge-request', respond);
  const value = () => controls.directionNativeReference.value ? JSON.parse(controls.directionNativeReference.value) : undefined;
  const serialize = () => serializeExtrudeDirection(Object.fromEntries(Object.entries(controls).map(([key, input]) => [key, input.value])), context);
  return { win, controls, mode, value, serialize, box: win.body.querySelector<HTMLElement>('[aria-label="Extrusion axis or edge"]')! };
}

it('removes an edge by repeated viewport click and by × while the preview is invalid', async () => {
  const f = await mount(); f.mode('reference');
  expect(validateExtrudeDirection(f.controls)).toMatch(/Select/);
  expect(click()).toBe(false); expect(f.value()).toEqual(edge);
  f.win.setError('Preview failed'); expect(click()).toBe(false); expect(f.value()).toBeUndefined();
  click(); cadSelection.dispatch({ type: 'replace', items: [item] });
  const button = f.box.querySelector<HTMLButtonElement>('button')!;
  button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(button.isConnected).toBe(true); button.click(); expect(f.value()).toBeUndefined();
  cadSelection.dispatch({ type: 'set-hovered', item }); expect(f.value()).toBeUndefined();
});

it('stores a persistent reference, retains it across mode toggles, and ignores inactive picks', async () => {
  const f = await mount(edge);
  expect(f.controls.directionMode.value).toBe('reference'); expect(f.serialize()).toEqual({ directionReference: edge });
  f.mode('normal'); expect(click()).toBe(true); expect(f.value()).toEqual(edge); expect(f.serialize()).toEqual({});
  f.mode('reference'); expect(f.serialize()).toEqual({ directionReference: edge });
  expect(validateExtrudeDirection(f.controls)).toBeNull();
  expect(f.serialize()).not.toHaveProperty('directionVector');
});

it('accepts only earlier available construction axes and permits removing a reopened reference', async () => {
  const f = await mount(axis);
  f.box.querySelector<HTMLButtonElement>('button')!.click(); expect(f.value()).toBeUndefined();
  const select = (id: string) => cadWorkspace.publish({ ...cadWorkspace.snapshot(), selectedItemIDs: new Set([`feature/axis/${id}`]) });
  select('later'); expect(f.value()).toBeUndefined(); select('suppressed'); expect(f.value()).toBeUndefined();
  select('axis'); expect(f.serialize()).toEqual({ directionReference: axis });
  f.mode('normal'); select('later'); select('axis'); expect(f.value()).toEqual(axis);
});

it('deselects a saved edge after archive key reordering or reversed endpoint traversal', async () => {
  const saved = { ...edge, anchor: { start: { positionMillimeters: edge.anchor.end.positionMillimeters, signature: edge.anchor.end.signature },
    end: { positionMillimeters: edge.anchor.start.positionMillimeters, signature: edge.anchor.start.signature } } };
  const f = await mount(saved);
  expect(click()).toBe(false); expect(f.value()).toBeUndefined();
});

for (const surfaceType of ['cylinder', 'cone']) it(`selects, toggles and removes a ${surfaceType} axis during failed preview`, async () => {
  const f = await mount(); f.mode('reference');
  const item = { id: 'face', kind: 'face', partId: 'guide-body', faceId: 3, label: 'Face' };
  const reference = { kind: 'face-axis', sourceFeatureId: 'guide', bodyId: 'guide-body', surfaceType, label: 'Axis of Face 3' };
  respondFace = event => {
    expect((event as CustomEvent).detail.selection).toEqual([item]);
    window.dispatchEvent(new CustomEvent('aether-extrude-direction-face', { detail: { reference } }));
  };
  window.addEventListener('aether-extrude-direction-face-request', respondFace);
  const pick = () => window.dispatchEvent(new CustomEvent('aether-feature-reference-click', { cancelable: true, detail: { item } }));
  expect(pick()).toBe(false); expect(f.serialize()).toEqual({ directionReference: reference });
  f.win.setError('Preview failed'); expect(pick()).toBe(false); expect(f.value()).toBeUndefined();
  pick(); const button = f.box.querySelector<HTMLButtonElement>('button')!;
  button.dispatchEvent(new Event('pointerdown', { bubbles: true })); expect(button.isConnected).toBe(true);
  button.click(); expect(f.value()).toBeUndefined();
  f.mode('normal'); expect(pick()).toBe(true); expect(f.value()).toBeUndefined();
});
