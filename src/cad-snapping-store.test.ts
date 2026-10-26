import { afterEach, expect, it, vi } from 'vitest';
import { CADSnappingStore, cadSnapping } from './cad-snapping-store';
import { snapSketchPoint } from './sketch-snapping';
const initial = cadSnapping.snapshot();
afterEach(() => cadSnapping.set(initial));
it('retains individual snap preferences across master toggles and reloads', () => {
  let saved = '';
  const storage = {getItem:()=>saved,setItem:(_key:string,value:string)=>{saved=value;}};
  const store = new CADSnappingStore(storage), changed = vi.fn(), release = store.subscribe(changed);
  store.set({grid:false}); store.set({enabled:false}); store.set({enabled:true});
  expect(new CADSnappingStore(storage).snapshot()).toEqual({enabled:true,geometry:true,grid:false});
  expect(changed).toHaveBeenCalledTimes(3); release(); store.set({geometry:false});
  expect(changed).toHaveBeenCalledTimes(3);
});
it('master and target settings change actual point placement without changing the drawing', () => {
  const drawing = {type:'drawing' as const,contours:[]};
  expect(snapSketchPoint([.1,.1],drawing,undefined,.2).point).toEqual([0,0]);
  cadSnapping.set({enabled:false});
  expect(snapSketchPoint([.1,.1],drawing,undefined,.2)).toEqual({point:[.1,.1],label:''});
  cadSnapping.set({enabled:true,geometry:false,grid:false});
  expect(snapSketchPoint([.1,.1],drawing,undefined,.2).point).toEqual([.1,.1]);
  cadSnapping.set({grid:true});
  expect(snapSketchPoint([.7,.7],drawing,undefined,.2)).toEqual({point:[1,1],label:'Grid · 1 mm'});
  expect(drawing.contours).toEqual([]);
});
