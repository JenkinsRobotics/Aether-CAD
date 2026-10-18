import {createRequire} from 'node:module';
import {act} from 'react';
import {beforeAll,afterAll,expect,it,vi} from 'vitest';
const queue=vi.fn();vi.mock('../modeling/cad-import-service',()=>({queueCADImport:(...args:unknown[])=>queue(...args)}));
let dom:any;
beforeAll(()=>{const {JSDOM}=createRequire(import.meta.url)('jsdom');dom=new JSDOM('<body></body>',{url:'http://localhost'});for(const key of ['window','document','HTMLElement','Element','Node','navigator','Event','KeyboardEvent'])vi.stubGlobal(key,dom.window[key]);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});
it('hands the selected supplier STEP file to the normal importer without automatic downloads',async()=>{
 const {createRoot}=await import('react-dom/client');const {CADMcMasterDialog}=await import('./CADMcMasterDialog');const host=document.createElement('div');document.body.append(host);const root=createRoot(host),close=vi.fn();
 try{
 await act(async()=>root.render(<CADMcMasterDialog open onClose={close}/>));
 expect(document.querySelector('a')?.getAttribute('href')).toBe('https://www.mcmaster.com/');
 const input=document.querySelector('input[type=file]') as HTMLInputElement;
 const file=new dom.window.File(['STEP data'],'hardware.step');Object.defineProperty(input,'files',{value:[file]});
 await act(async()=>input.dispatchEvent(new dom.window.Event('change',{bubbles:true})));
 expect(close).toHaveBeenCalledTimes(1);expect(queue).toHaveBeenCalledWith([file]);
 }finally{await act(async()=>root.unmount());host.remove();}
});
