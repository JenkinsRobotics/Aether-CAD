// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { CADToolbarControls } from './CADToolbarControls';
import { cadCommands } from '../cad-command-registry';
import { cadCameraPresentation } from '../cad-camera-presentation-store';
let root, container;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const button = label => document.querySelector(`button[aria-label="${label}"]`);
const click = async element => act(async () => element.click());
it('uses the registered viewport commands and reflects their availability and display state', async () => {
  const called = [], ids = ['display-wireframe','ground-grid','fit-view'];
  const cleanups = ids.map(id => cadCommands.register(id, () => called.push(id)));
  const cameraActions = [];
  cleanups.push(cadCameraPresentation.registerActionHandler(action => cameraActions.push(action)));
  try {
    ids.forEach(id => cadCommands.setEnabled(id, true));
    await act(async () => root.render(<CADToolbarControls history={[]} onHistory={() => {}}/>));
    await click(button('Display style'));
    await click([...document.querySelectorAll('[role="menuitemradio"]')].find(el => el.textContent.includes('Wireframe')));
    expect(called).toEqual(['display-wireframe']);
    await act(async () => cadCommands.setActive('display-wireframe', true));
    expect(button('Display style').querySelector('[data-icon="cube-transparent"]')).toBeTruthy();
    await click(button('Grid and construction planes'));
    await click([...document.querySelectorAll('[role="menuitemradio"]')].find(el => el.textContent === 'Grid'));
    await click(button('Frame'));
    expect(called).toEqual(['display-wireframe','ground-grid','fit-view']);
    await act(async () => cadCommands.setEnabled('fit-view', false));
    expect(button('Frame').disabled).toBe(true);
    await click(button('Camera views'));
    await click([...document.querySelectorAll('[role="menuitemradio"]')].find(el => el.textContent.includes('Orthographic')));
    expect(cameraActions).toEqual([{type:'set-projection', projection:'orthographic'}]);
    await click(button('Selection filters'));
    expect(document.querySelector('[role="dialog"][aria-label="Selection filters"]')).toBeTruthy();
    expect(document.querySelector('[data-icon-missing]')).toBeNull();
  } finally {
    cleanups.forEach(cleanup => cleanup());
    cadCommands.setActive('display-wireframe', false);
  }
});
