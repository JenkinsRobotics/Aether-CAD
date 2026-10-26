import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';
import { cadSnapping } from '../cad-snapping-store';
import { mountSketchSnappingControls } from './snapping-controls';
const {JSDOM} = createRequire(import.meta.url)('jsdom');
it('floating preference changes and sketch controls stay synchronized, then unsubscribe', () => {
  const dom = new JSDOM('<body></body>'), before = cadSnapping.snapshot();
  vi.stubGlobal('document',dom.window.document);
  const geometrySnap=vi.fn(), gridSnap=vi.fn();
  let release;
  try {
    cadSnapping.set({enabled:true,geometry:true,grid:true});
    release=mountSketchSnappingControls(document.body,{geometrySnap,gridSnap});
    const geometry=document.querySelector('[aria-label="Snap to geometry"]');
    const grid=document.querySelector('[aria-label="Snap to grid"]');
    cadSnapping.set({enabled:false});
    expect(geometry.disabled).toBe(true); expect(grid.disabled).toBe(true);
    expect(geometrySnap).toHaveBeenLastCalledWith(false); expect(gridSnap).toHaveBeenLastCalledWith(false);
    cadSnapping.set({enabled:true}); grid.click();
    expect(cadSnapping.snapshot()).toEqual({enabled:true,geometry:true,grid:false});
    expect(gridSnap).toHaveBeenLastCalledWith(false);
    release(); const calls=gridSnap.mock.calls.length; cadSnapping.set({grid:true});
    expect(gridSnap).toHaveBeenCalledTimes(calls);
  } finally { release?.(); cadSnapping.set(before); vi.unstubAllGlobals(); dom.window.close(); }
});
