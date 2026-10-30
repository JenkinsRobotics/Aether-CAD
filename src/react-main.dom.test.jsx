// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ controller: vi.fn(), roots: [] }));
vi.mock('react-dom/client', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, createRoot: (...args) => {
    const root = actual.createRoot(...args);
    state.roots.push(root);
    return root;
  } };
});
vi.mock('./home/Home', () => ({ Home: () => <main>CAD Home</main> }));
vi.mock('./react/AetherCADShell', () => ({ AetherCADShell: () => <main>CAD Editor</main> }));
vi.mock('./examples/ExamplesPage', () => ({
  ExamplesPage: () => <main>CAD Examples</main>, ExampleBanner: () => <aside>Example</aside>,
}));
vi.mock('./harness-demo/HarnessApp', () => ({ HarnessApp: () => <main>CAD Harness</main> }));

beforeEach(() => {
  vi.resetModules(); state.controller.mockClear();
  vi.doMock('./main', () => { state.controller(); return {}; });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => act(() => { for (const root of state.roots.splice(0)) root.unmount(); }));

test.each([
  ['/cad/', 'CAD Home', false],
  ['/cad/index.html', 'CAD Home', false],
  ['/cad/?storage=local', 'CAD Home', false],
  ['/cad/?examples=1', 'CAD Examples', false],
  ['/cad/?demo=harness', 'CAD Harness', false],
  ['/cad/?document=saved-part', 'CAD Editor', true],
  ['/cad/?document=saved-part&revision=2', 'CAD Editor', true],
  ['/cad/?draft=recover-my-work', 'CAD Editor', true],
  ['/cad/?draft=recover-my-work&storage=local', 'CAD Editor', true],
  ['/cad/?editor=1', 'CAD Editor', true],
  ['/cad/?new=part', 'CAD Editor', true],
  ['/cad/?example=space-shuttle', 'CAD Editor', true],
])('%s boots %s without changing the address', async (url, screen, editor) => {
  history.replaceState(null, '', url);
  const before = location.href;
  await act(async () => { await import('./react-main'); await vi.dynamicImportSettled(); });
  expect(document.querySelector('main')?.textContent).toBe(screen);
  expect(state.controller).toHaveBeenCalledTimes(editor ? 1 : 0);
  expect(location.href).toBe(before);
});
