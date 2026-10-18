import { createRequire } from 'node:module';
import React, { act } from 'react';
import { beforeAll, beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

/**
 * The rail's new panels do real work (Jonathan, 2026-10-02). These pin the
 * two that carry state: Create version posts to the host's version action
 * with the document and its revision, and Reminders persist per document.
 */
let root, container, Panels, dom, posted;
beforeAll(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/cad/index.html?document=doc-7', pretendToBeVisual: true });
  for (const key of ['window','document','navigator','HTMLElement','Element','Node','HTMLInputElement','Event','MouseEvent','KeyboardEvent','localStorage','location','crypto'])
    vi.stubGlobal(key, dom.window[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  posted = [];
  vi.stubGlobal('fetch', async (url, init) => { posted.push([String(url), JSON.parse(init?.body ?? '{}')]); return { ok: true, json: async () => ({ ok: true, revision: 4 }) }; });
  // The host library resolves the open document from the host; give it one.
  vi.doMock('../../host-library', () => ({ commitHosted: async (name, message) => { posted.push(['commitHosted', { name, message }]); } }));
  Panels = await import('./rail');
});
beforeEach(async () => {
  container = document.createElement('div'); document.body.append(container);
  const { createRoot } = await import('react-dom/client'); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
afterAll(() => dom.window.close());

const type = (input, value) => act(async () => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
});

it('Create version names the state and hands it to the host', async () => {
  await act(async () => root.render(<Panels.CreateVersionPanel />));
  const form = container.querySelector('form');
  await type(form.querySelector('input'), 'V2');
  await act(async () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  expect(posted.at(-1)).toEqual(['commitHosted', { name: 'V2', message: '' }]);
  expect(container.querySelector('[role="status"]').textContent).toBe('Version V2 created.');
});

it('Reminders persist with the document and come back on reload', async () => {
  await act(async () => root.render(<Panels.RemindersPanel />));
  const form = container.querySelector('form');
  await type(form.querySelector('input[aria-label="Reminder"]'), 'Check wall thickness');
  await act(async () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  expect([...container.querySelectorAll('.cad-rail-list li span')].map(e => e.textContent)).toEqual(['Check wall thickness']);
  expect(JSON.parse(localStorage.getItem('aether-cad.reminders.doc-7')).map(r => r.text)).toEqual(['Check wall thickness']);
  await act(async () => root.unmount()); root = (await import('react-dom/client')).createRoot(container);
  await act(async () => root.render(<Panels.RemindersPanel />));
  expect(container.querySelector('.cad-rail-list li span').textContent).toBe('Check wall thickness');
});
