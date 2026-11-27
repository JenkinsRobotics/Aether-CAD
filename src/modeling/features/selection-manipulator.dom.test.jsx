import { createRequire } from 'node:module';
import { beforeAll, afterAll, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mountSelectionManipulator } from './selection-manipulator';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom, viewer, apply, dispose, editable, selected, revision, viewport;
beforeAll(() => {
  dom = new JSDOM('<body/>', { pretendToBeVisual: true, url: 'https://cad.test' });
  for (const key of ['window', 'document', 'Event', 'CustomEvent', 'HTMLCanvasElement']) vi.stubGlobal(key, dom.window[key]);
  vi.stubGlobal('requestAnimationFrame', dom.window.requestAnimationFrame.bind(dom.window));
  vi.stubGlobal('cancelAnimationFrame', dom.window.cancelAnimationFrame.bind(dom.window));
});
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });
beforeEach(() => {
  document.body.innerHTML = '<main><canvas/></main>';
  viewport = document.querySelector('main'); editable = true; selected = 'occurrence'; revision = '1';
  viewer = {
    manipulatorFrame: () => ({ centerMillimeters: [5, 10, 2.5], radiusMillimeters: 10 }),
    clearManipulatorPreview: vi.fn(), clearInteractionAnchors: vi.fn(), previewManipulatorTransform: vi.fn(),
    pickManipulatorPivot: () => ({ point: [10, 20, 5] }),
    projectSelectionManipulator: vi.fn(pivot => [
      { id: 'moveX', kind: 'axis', label: 'Move X', x: 100, y: 100, axis: [1, 0, 0], sample: x => [x, 0, 0] },
      { id: 'rotateZ', kind: 'rotation', label: 'Rotate Z', x: 150, y: 150, axis: [0, 0, 1], sample: x => x },
      { id: 'pivot', kind: 'pivot', label: 'Pivot', x: pivot[0], y: pivot[1], sample: () => null },
    ]),
  };
  apply = vi.fn(async () => { revision = '2'; });
  dispose = mountSelectionManipulator({ viewport, viewer, status: vi.fn(), capture: () => {
    if (!editable || !selected) return null;
    const captured = revision;
    return { key: selected, revision, ids: ['body'], current: () => editable && revision === captured, apply };
  } });
});
afterEach(() => { dispose(); document.body.innerHTML = ''; });
const button = async id => {
  await vi.waitFor(() => expect(document.querySelector(`[data-transform-handle="${id}"]`)?.hidden).toBe(false));
  const b = document.querySelector(`[data-transform-handle="${id}"]`); b.setPointerCapture = vi.fn(); b.hasPointerCapture = () => false; return b;
};
const pointer = (b, type, x, shiftKey = false) => {
  const event = new dom.window.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 0, shiftKey });
  Object.defineProperty(event, 'pointerId', { value: 1 }); b.dispatchEvent(event);
};
it('previews continuously, follows the body and commits exactly once on release', async () => {
  const b = await button('moveX'); pointer(b, 'pointerdown', 100); pointer(b, 'pointermove', 110); pointer(b, 'pointermove', 120, true);
  expect(apply).not.toHaveBeenCalled();
  expect(viewer.previewManipulatorTransform.mock.calls.at(-1)[1].translationMillimeters).toEqual([11, 0, 0]);
  await vi.waitFor(() => expect(viewer.projectSelectionManipulator).toHaveBeenLastCalledWith([16, 10, 2.5]));
  pointer(b, 'pointerup', 120);
  await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect(apply.mock.calls[0][0]).toEqual({ kind: 'translate', translationMillimeters: [11, 0, 0] });
  expect(viewer.clearManipulatorPreview).toHaveBeenCalledWith(false);
});
it.each(['escape', 'blur', 'selection', 'readonly', 'revision', 'navigation'])('cancels without a write when %s interrupts a drag', async reason => {
  const b = await button('moveX'); pointer(b, 'pointerdown', 100); pointer(b, 'pointermove', 120);
  if (reason === 'escape') window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  if (reason === 'blur') window.dispatchEvent(new Event('blur'));
  if (reason === 'selection') selected = null;
  if (reason === 'readonly') editable = false;
  if (reason === 'revision') revision = '3';
  if (reason === 'navigation') window.dispatchEvent(new Event('cad-document-navigation'));
  await vi.waitFor(() => expect(document.body.dataset.cadHandleDrag).toBeUndefined());
  pointer(b, 'pointerup', 120); expect(apply).not.toHaveBeenCalled(); expect(viewer.clearManipulatorPreview).toHaveBeenCalled();
});
it('retains the preview until the saved canonical pose is rendered', async () => {
  let finish;
  apply.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const b = await button('moveX'); pointer(b, 'pointerdown', 100); pointer(b, 'pointermove', 120); pointer(b, 'pointerup', 120);
  expect(apply).toHaveBeenCalledOnce(); expect(viewer.clearManipulatorPreview).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(b.disabled).toBe(true));
  revision = '2'; finish();
  await vi.waitFor(() => expect(viewer.clearManipulatorPreview).toHaveBeenCalledWith(false));
});
it('moves only the pivot before rotating around the chosen point', async () => {
  const p = await button('pivot'); pointer(p, 'pointerdown', 0); pointer(p, 'pointermove', 10); pointer(p, 'pointerup', 10);
  expect(apply).not.toHaveBeenCalled();
  const b = await button('rotateZ'); pointer(b, 'pointerdown', 170); pointer(b, 'pointermove', -170); pointer(b, 'pointerup', -170);
  await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect(apply.mock.calls[0][0]).toEqual({ kind: 'rotate', axisOriginMillimeters: [10, 20, 5], axisDirection: [0, 0, 1], angleDegrees: 20 });
});
it('shows no implicit part-edit or copy affordance without a permitted occurrence', async () => {
  await button('moveX'); expect(document.querySelector('.aui-manipulator-copy')?.hidden ?? true).toBe(true);
  selected = null;
  await vi.waitFor(() => expect(document.querySelector('[data-transform-handle="moveX"]').hidden).toBe(true));
  expect(apply).not.toHaveBeenCalled();
});
it('restores the preview on a rejected edit', async () => {
  apply.mockRejectedValue(new Error('Assembly solve failed'));
  const b = await button('moveX'); pointer(b, 'pointerdown', 100); pointer(b, 'pointermove', 120); pointer(b, 'pointerup', 120);
  await vi.waitFor(() => expect(viewer.clearManipulatorPreview).toHaveBeenCalledWith());
  expect(revision).toBe('1');
});
