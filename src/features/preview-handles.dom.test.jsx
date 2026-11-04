import { createRequire } from 'node:module';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { mountAngleHandle } from './preview-handles';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom;
beforeAll(() => {
  dom = new JSDOM('<body></body>', { pretendToBeVisual: true });
  for (const key of ['window', 'document', 'Event', 'CustomEvent']) vi.stubGlobal(key, dom.window[key]);
});
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });

it('keeps a revolve ribbon at its actual angle and accepts complete angle expressions', async () => {
  document.body.innerHTML = '<div class="cad-studio-viewport"><div id="panel" data-feature-id="revolve"></div></div>';
  const panel = document.querySelector('#panel'), control = document.createElement('input');
  control.value = '90'; control.dataset.canonicalFactor = '1';
  let ready = false;
  const circle = angle => ({ x: 100 + 50 * Math.cos(angle * Math.PI / 180), y: 100 + 50 * Math.sin(angle * Math.PI / 180) });
  const respond = event => event.detail.respond({ ...circle(event.detail.angle), pointAt: circle,
    points: Array.from({ length: 65 }, (_, i) => circle(i * 360 / 64)),
    valueAt: (x, y) => Math.atan2(y - 100, x - 100) * 180 / Math.PI });
  window.addEventListener('aether-native-angle-handle', respond);
  try {
    mountAngleHandle(panel, control, 'deg', () => ({ parameter: 'angle', kind: 'angular', originMillimeters: [0, 0, 0], direction: [0, 0, 1] }), () => ready, 'Revolve angle');
    const hit = document.querySelector('.aui-manipulator-orbit-hit');
    const arrow = document.querySelector('.aui-manipulator-orbit-arrow');
    expect(arrow.getAttribute('points').split(' ').map(p => Number(p.split(',')[1])).every(y => y > 130)).toBe(true);
    ready = true; await vi.waitFor(() => expect(hit.getAttribute('aria-disabled')).toBe('false'));
    hit.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(control.value).toBe('105');
    const input = document.querySelector('.aui-manipulator-readout');
    input.focus(); input.value = 'pi/2 rad'; input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(Number(control.value)).toBeCloseTo(90);
    input.focus(); input.value = '45 invalid'; input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(Number(control.value)).toBeCloseTo(90); expect(input.validity.valid).toBe(false);
    ready = false; await vi.waitFor(() => expect(hit.getAttribute('aria-disabled')).toBe('true'));
    hit.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(Number(control.value)).toBeCloseTo(90);
  } finally { panel.remove(); window.removeEventListener('aether-native-angle-handle', respond); }
});
