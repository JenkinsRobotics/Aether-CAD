import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cadSelection } from '../cad-selection-store';
import { mountPickedReferences, faceIdentity } from './picked-references';
import type { FeatureEditorContext } from './shared';

const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom: any;
let close: (() => void) | undefined;
let respond: EventListener;
beforeAll(() => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/cad/' });
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'CustomEvent', 'Event', 'location']) vi.stubGlobal(key, dom.window[key]);
});
afterEach(async () => {
  close?.(); window.removeEventListener('test-reference-request', respond);
  await new Promise(resolve => setTimeout(resolve, 0)); cadSelection.dispatch({ type: 'clear' });
});
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });

const nativeFace = (id: string) => ({ id, sourceFeatureId: 'revolve', bodyId: 'body', surfaceType: 'cone', label: 'Face of Revolve 9',
  faceAnchor: { centerMillimeters: [id === 'first' ? 1 : 2, 0, 0], areaSquareMillimeters: 20 } });
async function mount(native = false) {
  const { openFeatureWindow } = await import('@aether/ui');
  const win = openFeatureWindow({ viewport: document.body, className: 'test-window', title: 'Chamfer',
    acceptLabel: 'Apply', discardLabel: 'Cancel', onAccept() {}, onDiscard() {} });
  close = win.close;
  const form = document.createElement('form'); form.id = 'test-form'; win.body.append(form);
  const control = document.createElement('input'); control.value = '[]'; form.append(control);
  const picker = mountPickedReferences<any>({ win, form } as FeatureEditorContext, control, {
    title: 'Entities', kind: 'face', requestEvent: 'test-reference-request', replyEvent: 'test-reference-reply', replyKey: 'faces', identity: native ? faceIdentity : ref => ref.id,
  });
  respond = event => {
    const selection = (event as CustomEvent).detail?.selection ?? cadSelection.snapshot().items;
    window.dispatchEvent(new CustomEvent('test-reference-reply', { detail: { faces: selection.map((item: { id: string }) => native ? nativeFace(item.id) : ({ id: item.id, label: 'Face of Revolve 9' })) } }));
  };
  window.addEventListener('test-reference-request', respond);
  return { win, picker, control };
}
const item = (id: string) => ({ id, kind: 'face' as const, partId: 'body', label: 'Face of Revolve 9' });
const click = (id: string) => window.dispatchEvent(new CustomEvent('aether-feature-reference-click', { cancelable: true, detail: { item: item(id) } }));

it('keeps the remove button attached between pointerdown and click while a preview is invalid', async () => {
  const { win, picker } = await mount();
  cadSelection.dispatch({ type: 'replace', items: [item('first')] });
  picker.update([{ id: 'first', label: 'Face of Revolve 9' }, { id: 'second', label: 'Face of Revolve 9' }]);
  win.setError('Chamfer did not produce a valid solid.');
  const button = picker.element.querySelector<HTMLButtonElement>('button')!;
  button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(button.isConnected).toBe(true);
  button.click();
  expect(picker.read().map(ref => ref.id)).toEqual(['second']);
  picker.element.querySelector<HTMLButtonElement>('button')!.click();
  expect(picker.read()).toEqual([]);
});

it('toggles only the clicked reference and leaves other inputs selected across preview refreshes', async () => {
  const { picker, win } = await mount();
  expect(click('first')).toBe(false);
  expect(click('second')).toBe(false);
  expect(picker.read().map(ref => ref.id)).toEqual(['first', 'second']);
  win.setError('Preview failed');
  expect(click('first')).toBe(false);
  expect(picker.read().map(ref => ref.id)).toEqual(['second']);
  cadSelection.dispatch({ type: 'set-hovered', item: item('first') });
  expect(picker.read().map(ref => ref.id)).toEqual(['second']);
  expect(click('second')).toBe(false);
  expect(picker.read()).toEqual([]);
  expect(click('first')).toBe(false);
  expect(picker.read().map(ref => ref.id)).toEqual(['first']);
});

it('removes an archived native face after the codec reorders its discriminator, preserving the other same-label face', async () => {
  const { picker, win } = await mount(true), first = nativeFace('first');
  const saved = { ...first, faceAnchor: { areaSquareMillimeters: 20, centerMillimeters: [1, 0, 0] } };
  expect(faceIdentity(saved)).toBe(faceIdentity(first));
  expect(faceIdentity(saved)).not.toBe(faceIdentity(nativeFace('second')));
  picker.update([saved, nativeFace('second')]); win.setError('Invalid solid');
  click('first'); expect(picker.read().map(ref => ref.id)).toEqual(['second']);
  const remove = picker.element.querySelector<HTMLButtonElement>('button')!;
  remove.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(remove.isConnected).toBe(true); remove.click(); expect(picker.read()).toEqual([]);
});
