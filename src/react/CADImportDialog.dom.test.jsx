import {createRequire} from 'node:module';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import React,{act,useSyncExternalStore} from 'react';
import {cadPresentation} from '../cad-presentation-store';
import {configureCADImport,queueCADImport,clearImportFiles} from '../modeling/cad-import-service';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
let root,container,Dialog,dom,commit;
beforeAll(async()=>{
 dom=new JSDOM('<html><body></body></html>',{url:'http://localhost/',pretendToBeVisual:true});
 for(const key of ['window','document','navigator','HTMLElement','Element','Node','HTMLInputElement','Event','MouseEvent','KeyboardEvent'])vi.stubGlobal(key,dom.window[key]);
 vi.stubGlobal('requestAnimationFrame',dom.window.requestAnimationFrame.bind(dom.window));vi.stubGlobal('cancelAnimationFrame',dom.window.cancelAnimationFrame.bind(dom.window));
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 Dialog=(await import('./CADImportDialog')).CADImportDialog;
});
function Harness(){const state=useSyncExternalStore(cadPresentation.subscribe,cadPresentation.snapshot);return <Dialog presentation={state}/>;}
beforeEach(async()=>{
 clearImportFiles();cadPresentation.patch({startDialog:'import'});commit=vi.fn();
 configureCADImport({current:()=>null,available:()=>true,evaluate:async()=>({parts:[],parseMilliseconds:1}),commit});
 container=document.createElement('div');document.body.append(container);
 const {createRoot}=await import('react-dom/client');root=createRoot(container);
 await act(async()=>root.render(<Harness/>));
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();clearImportFiles();});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});
async function click(label){const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);expect(b).toBeTruthy();await act(async()=>b.click());}
it('lets the user choose mesh units and solid conversion and commits those choices',async()=>{
 await act(async()=>queueCADImport([new File(['mesh'],'bracket.STL')]));
 expect(document.querySelector('[role="dialog"]').textContent).toContain('bracket.STL');
 for(const [id,value] of [['import-mesh-units','in'],['import-mesh-mode','solid']])await act(async()=>{const s=document.getElementById(id);s.value=value;s.dispatchEvent(new Event('change',{bubbles:true}));});
 await click('Import');
 expect(commit).toHaveBeenCalledTimes(1);
 expect(commit.mock.calls[0][0].features[0]).toMatchObject({format:'stl',meshMode:'solid',meshUnits:'in'});
 expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('explains native SolidWorks conversion and disables unsupported import',async()=>{
 await act(async()=>queueCADImport([new File(['native'],'gear.sldprt')]));
 expect(document.querySelector('[role="alert"]').textContent).toContain('Export STEP');
 expect([...document.querySelectorAll('button')].find(b=>b.textContent==='Import').disabled).toBe(true);
 expect(commit).not.toHaveBeenCalled();
});
it('keeps invalid geometry errors visible and preserves the file selection for retry',async()=>{
 configureCADImport({current:()=>null,available:()=>true,evaluate:async()=>{throw Error('The mesh is not closed');},commit});
 await act(async()=>queueCADImport([new File(['open'],'open.stl')]));await click('Import');
 expect(document.querySelector('[role="alert"]').textContent).toBe('The mesh is not closed');
 expect(document.querySelector('[role="dialog"]')).not.toBeNull();expect(commit).not.toHaveBeenCalled();
});
it('cancel waits for native evaluation and prevents its late result from committing',async()=>{
 let finish;const pending=new Promise(r=>{finish=r;});
 configureCADImport({current:()=>null,available:()=>true,evaluate:()=>pending,commit});
 await act(async()=>queueCADImport([new File(['mesh'],'mesh.stl')]));await click('Import');await click('Cancel');
 expect(document.querySelector('[role="status"]').textContent).toContain('Nothing will be added');
 await act(async()=>finish({parts:[],parseMilliseconds:1}));
 expect(commit).not.toHaveBeenCalled();expect(document.querySelector('[role="dialog"]')).toBeNull();
});
