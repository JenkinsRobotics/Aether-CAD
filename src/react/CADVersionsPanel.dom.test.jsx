import { createRequire } from 'node:module';
import React, { act } from 'react';
import { beforeAll, beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

/**
 * The panel is Onshape's, which Jonathan supplied as the reference
 * (2026-10-02). These pin the parts of it that are structure rather than
 * styling: the titled header, the search, the named columns, one mark per row
 * drawn from the shared icon pack, the legend that explains those marks, and
 * the right-click hint. The legend is the easy one to let rot, because nothing
 * breaks visibly when an icon name stops resolving — it just renders empty.
 */
const HISTORY = {
  revisions: [
    { revision: 1, author: 'Jonathan Jenkins', saved: 1757000000, event: 'create', note: 'Start', branch: 'Main', parent_revision: null },
    { revision: 2, author: 'Jonathan Jenkins', saved: 1757100000, event: 'save', note: 'Extrude boss', branch: 'Main', parent_revision: 1 },
    { revision: 3, author: 'Jonathan Jenkins', saved: 1757200000, event: 'save', note: 'Fillet edges', branch: 'Main', parent_revision: 2 },
    { revision: 4, author: 'Jonathan Jenkins', saved: 1757300000, event: 'save', note: 'Shell', branch: 'Main', parent_revision: 3 },
    { revision: 5, author: 'Jonathan Jenkins', saved: 1757400000, event: 'save', note: 'Head', branch: 'Main', parent_revision: 4 },
  ],
  versions: [{ name: 'V1', revision: 3, created: 1757200000, message: 'First cut' }],
  branches: [{ name: 'Main', head_revision: 5, created_from: null }],
};

let root, container, Panel, dom;
beforeAll(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/cad/index.html?document=doc-1', pretendToBeVisual: true });
  for (const key of ['window','document','navigator','HTMLElement','Element','Node','HTMLInputElement','Event','MouseEvent','KeyboardEvent','localStorage','location'])
    vi.stubGlobal(key, dom.window[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => HISTORY }));
  Panel = (await import('./CADVersionsPanel')).CADVersionsPanel;
});
beforeEach(async () => {
  container = document.createElement('div');
  document.body.append(container);
  const { createRoot } = await import('react-dom/client');
  root = createRoot(container);
  await act(async () => root.render(<Panel documentName="Part 1" />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
afterAll(() => dom.window.close());

it('draws the reference structure: header, search, columns, legend and hint', () => {
  expect(container.querySelector('.cad-version-head h2').textContent).toBe('Versions and history');
  expect(container.querySelector('.cad-version-search input').getAttribute('placeholder')).toBe('Search history');
  expect([...container.querySelectorAll('.cad-version-columns span')].map(s => s.textContent)).toEqual(['Name', 'Modified']);
  expect(container.querySelector('.cad-version-foot').textContent).toContain('Right-click on a row to perform actions');
});

it('names every mark in the legend, and draws an icon for each', () => {
  const rows = [...container.querySelectorAll('.cad-version-legend > div')];
  expect(rows.map(r => r.querySelector('dd').textContent)).toEqual([
    'Branch', 'Workspace', 'Version', 'Change', 'Release candidate', 'Release', 'Contains obsoletion', 'Automatic version',
  ]);
  // An icon name the pack cannot resolve renders nothing, which is invisible
  // until someone looks at the panel.
  for (const row of rows) expect(row.querySelector('dt svg'), row.textContent).toBeTruthy();
});

it('shows a row per workspace head and version, each with its own mark', () => {
  const nodes = [...container.querySelectorAll('.cad-version-node')];
  expect(nodes.map(n => n.getAttribute('data-kind'))).toEqual(['workspace', 'version', 'change']);
  expect(nodes[0].querySelector('.cad-version-name strong').textContent).toBe('Main (workspace)');
  expect(nodes[1].querySelector('.cad-version-name strong').textContent).toBe('V1');
  for (const node of nodes) expect(node.querySelector('.cad-version-marker svg')).toBeTruthy();
});

it('folds the plain saves under the milestone above them, one row at a time', async () => {
  const workspace = container.querySelector('.cad-version-node[data-kind="workspace"]');
  const expand = workspace.querySelector('.cad-version-expand');
  expect(expand.getAttribute('aria-expanded')).toBe('false');
  expect(workspace.querySelector('.cad-version-changes')).toBeNull();
  await act(async () => expand.click());
  expect(expand.getAttribute('aria-expanded')).toBe('true');
  expect(workspace.querySelectorAll('.cad-version-changes li').length).toBe(1);
});

it('searches the history by name and author', async () => {
  const input = container.querySelector('.cad-version-search input');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'V1');
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const names = [...container.querySelectorAll('.cad-version-name strong')].map(s => s.textContent);
  expect(names).toEqual(['V1']);
});

it('carries the reference header slots and enables restore only for a selected, non-current row', async () => {
  const labels = [...container.querySelectorAll('.cad-version-head-actions button')].map(b => b.getAttribute('aria-label'));
  expect(labels).toEqual(['Create version', 'Compare history entries', 'Merge a branch into this one']);
  // The toolbar row: branch from the selection, restore the selection, refresh.
  const tools = [...container.querySelectorAll('.cad-version-tools button')].map(b => b.getAttribute('aria-label'));
  expect(tools).toEqual(['Branch from the selected entry', 'Restore the selected entry', 'Refresh history']);
  const restore = container.querySelector('.cad-version-tools button[aria-label="Restore the selected entry"]');
  expect(restore.disabled).toBe(true);
  // Picking the current workspace head must not offer to restore it to itself.
  await act(async () => container.querySelector('.cad-version-node[data-kind="workspace"]').click());
  expect(restore.disabled).toBe(true);
  await act(async () => container.querySelector('.cad-version-node[data-kind="version"]').click());
  expect(restore.disabled).toBe(false);
  expect(container.querySelector('.cad-version-node[data-selected]').getAttribute('data-kind')).toBe('version');
});

it('compare takes the selection and the next row clicked, then shows the feature diff', async () => {
  vi.stubGlobal('fetch', async (url) => ({ ok: true, json: async () => String(url).endsWith('/compare')
    ? { from: 5, to: 3, base: 3, same_content: false, from_only: [{ revision: 5 }, { revision: 4 }], to_only: [],
        features: { added: [{ id: 'f9', name: 'Fillet 2' }], removed: [], changed: [{ id: 'f1', name: 'Sketch 1' }] } }
    : HISTORY }));
  const compare = container.querySelector('button[aria-label="Compare history entries"]');
  expect(compare.disabled).toBe(true);
  await act(async () => container.querySelector('.cad-version-node[data-kind="workspace"]').click());
  expect(compare.disabled).toBe(false);
  await act(async () => compare.click());
  expect(compare.getAttribute('aria-pressed')).toBe('true');
  await act(async () => container.querySelector('.cad-version-node[data-kind="version"]').click());
  const result = container.querySelector('.cad-version-compare');
  expect(result.textContent).toContain('r5 → r3');
  expect(result.querySelector('pre').textContent).toBe('Added: Fillet 2\nChanged: Sketch 1');
});

it('a version row offers rename and delete; other rows do not', () => {
  expect(container.querySelector('.cad-version-node[data-kind="version"] .cad-version-row-actions')).toBeTruthy();
  expect(container.querySelector('.cad-version-node[data-kind="workspace"] .cad-version-row-actions')).toBeNull();
});

