import {createRequire} from 'node:module';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {openAssemblyRecipeDialog} from './assembly-recipe-dialog';
import type {CADAssemblyController} from '../cad-assembly-controller';
let dom:any;
beforeAll(()=>{
  const {JSDOM}=createRequire(import.meta.url)('jsdom');dom=new JSDOM('<body></body>',{url:'http://localhost'});
  for(const key of ['window','document','Option','Event'])vi.stubGlobal(key,dom.window[key]);
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});
it('edits JSON, reuses a chosen Part and submits the actual circular array command',async()=>{
  const composeRecipe=vi.fn(async()=>({}));
  openAssemblyRecipeDialog({composeRecipe,geometryProjection:{part_definitions:[{id:'part-existing',name:'Bracket',feature_document:{}}]}} as unknown as CADAssemblyController,'circular');
  const select=document.querySelector('select')!;select.value='part-existing';select.dispatchEvent(new Event('change'));
  const editor=document.querySelector('textarea')!;
  const spec=JSON.parse(editor.value);expect(spec.parts).toEqual([{key:'block',part_id:'part-existing'}]);expect(spec.patterns[0].kind).toBe('circular');
  document.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));await Promise.resolve();await Promise.resolve();
  expect(composeRecipe).toHaveBeenCalledWith(spec,expect.any(AbortSignal));expect(document.querySelector('dialog')).toBeNull();
});
it('retains the input after failure and cancellation aborts the in-flight request',async()=>{
  const composeRecipe=vi.fn(async(_recipe:unknown,_signal:AbortSignal)=>{throw Error('Invalid geometry');});
  openAssemblyRecipeDialog({composeRecipe,geometryProjection:null} as unknown as CADAssemblyController);
  const form=document.querySelector('form')!;form.dispatchEvent(new Event('submit',{cancelable:true}));await Promise.resolve();await Promise.resolve();
  expect(document.querySelector('[role=status]')!.textContent).toBe('Invalid geometry');
  expect(document.querySelector<HTMLTextAreaElement>('textarea')!.disabled).toBe(false);
  const signal=composeRecipe.mock.calls[0][1] as AbortSignal;
  document.querySelector('dialog')!.dispatchEvent(new Event('cancel',{cancelable:true}));
  expect(signal.aborted).toBe(true);expect(document.querySelector('dialog')).toBeNull();
});
