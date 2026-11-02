// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { CADToolbarControls } from './CADToolbarControls';
let root, container;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it('holds only undo and redo; viewport controls stay with the viewport', async () => {
  const called = [];
  await act(async () => root.render(<CADToolbarControls history={[{id:'part-undo',label:'Undo'},{id:'part-redo',label:'Redo',disabled:true}]} onHistory={id => called.push(id)}/>));
  expect([...container.querySelectorAll('button')].map(b => b.getAttribute('aria-label'))).toEqual(['Undo','Redo']);
  await act(async () => container.querySelector('button[aria-label="Undo"]').click());
  expect(called).toEqual(['part-undo']);
  expect(container.querySelector('button[aria-label="Redo"]').disabled).toBe(true);
});
