import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('migrates a saved fifth History icon into the existing Version control slot', async () => {
  vi.stubGlobal('localStorage', {
    getItem: () => JSON.stringify(['comments', 'advisor', 'history', 'versions', 'files']),
    setItem: vi.fn(),
  });
  const preferences = await import('./aux-toolbar-preferences');
  expect(preferences.auxToolbarItems()).toEqual(['comments', 'advisor', 'versions', 'files']);
  expect(preferences.AUX_TOOLBAR_ITEMS.some(item => item.id === ('history' as string))).toBe(false);
});
