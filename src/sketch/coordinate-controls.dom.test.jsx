import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
import { mountSketchCoordinates } from './coordinate-controls';
let dom;
afterEach(() => { vi.unstubAllGlobals(); dom?.window.close(); });
it('groups XY into the shared row, keeps placement functional and hides unrelated tool options', () => {
  dom = new JSDOM('<main/>'); vi.stubGlobal('document', dom.window.document);
  const parent = document.querySelector('main'), place = vi.fn();
  const control = mountSketchCoordinates(parent, { place, preview: vi.fn(), changed: vi.fn(), newContour: vi.fn(), closeContour: vi.fn(), geometrySnap: vi.fn(), gridSnap: vi.fn() });
  control.update('circle');
  const group = parent.querySelector('.aui-coordinate-fields');
  expect(group.getAttribute('aria-label')).toBe('Point (mm)');
  const x = parent.querySelector('[aria-label="X (mm)"]'), y = parent.querySelector('[aria-label="Y (mm)"]');
  expect(group.contains(x) && group.contains(y)).toBe(true);
  x.value = '12'; y.value = '-4'; [...parent.querySelectorAll('button')].find(button => button.textContent === 'Place point').click();
  expect(place).toHaveBeenCalledWith([12, -4]);
  expect(parent.querySelector('.sketch-contour-actions').hidden).toBe(true);
  expect(parent.querySelector('[aria-label="Polygon sides"]').parentElement.hidden).toBe(true);
  expect(parent.querySelector('details').open).toBe(false);
  control.update('rectangle'); expect(parent.querySelector('.sketch-contour-actions').hidden).toBe(true);
  control.update('line'); expect(parent.querySelector('.sketch-contour-actions').hidden).toBe(true); // no contour buttons for people (2026-11-01)
  control.update('inscribed-polygon'); expect(parent.querySelector('[aria-label="Polygon sides"]').parentElement.hidden).toBe(false);
});
