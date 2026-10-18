import {createRequire} from 'node:module';
import React,{act} from 'react';
import {beforeAll,afterAll,expect,it,vi} from 'vitest';
import {cadCommands} from '../cad-command-registry';
const require=createRequire(import.meta.url);
const {JSDOM}=require('jsdom');
let dom;
beforeAll(()=>{
 dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost',pretendToBeVisual:true});
 for(const key of ['window','document','HTMLElement','Element','Node','navigator','Event','KeyboardEvent'])vi.stubGlobal(key,dom.window[key]);
 vi.stubGlobal('requestAnimationFrame',dom.window.requestAnimationFrame.bind(dom.window));
 vi.stubGlobal('cancelAnimationFrame',dom.window.cancelAnimationFrame.bind(dom.window));
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}unobserve(){}});
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});
it('keeps a chosen solid tab during sketch edits and exposes direct sketch-to-solid commands',async()=>{
 const {CADTraditionalRibbon}=await import('./CADTraditionalRibbon');const {createRoot}=await import('react-dom/client');
 const dispose=cadCommands.register('feature-extrude',()=>{});cadCommands.setEnabled('feature-extrude',true);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),action=vi.fn();
 const props={documentType:'part',sketchEditing:true,activeWorkspace:'solid',partOpen:true,onSelectWorkspace:()=>{},onAction:action};
 try{
  await act(async()=>root.render(<CADTraditionalRibbon {...props}/>));
  expect(host.querySelector('[data-ribbon-workspace="sketch-context"]')).toBeTruthy();
  await act(async()=>host.querySelector('[data-tool-id="solid-extrude"] .aui-ribbon-tool').click());
  expect(action).toHaveBeenLastCalledWith('feature-extrude');
  await act(async()=>host.querySelector('[role="tab"][aria-label="Solid"]').click());
  expect(host.querySelector('[data-ribbon-workspace="solid"]')).toBeTruthy();
  await act(async()=>cadCommands.setEnabled('feature-extrude',false));
  expect(host.querySelector('[data-ribbon-workspace="solid"]')).toBeTruthy();
  await act(async()=>root.render(<CADTraditionalRibbon {...props} sketchEditing={false}/>));
  expect(host.querySelector('[data-ribbon-workspace="solid"]')).toBeTruthy();
  await act(async()=>root.render(<CADTraditionalRibbon {...props}/>));
  expect(host.querySelector('[data-ribbon-workspace="sketch-context"]')).toBeTruthy();
 }finally{await act(async()=>root.unmount());dispose();host.remove();}
});
it('chooses a variant from the dropdown and retains it as the primary tool',async()=>{
 const {CADTraditionalRibbon}=await import('./CADTraditionalRibbon');
 const {createRoot}=await import('react-dom/client');
 cadCommands.register('sketch-line',()=>{});cadCommands.register('sketch-midpoint-line',()=>{});
 cadCommands.setEnabled('sketch-line',true);cadCommands.setEnabled('sketch-midpoint-line',true);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),action=vi.fn();
 await act(async()=>root.render(<CADTraditionalRibbon activeWorkspace="sketch" sketchEditing documentName="Sketch" partOpen onSelectWorkspace={()=>{}} onAction={action} onUseFloatingTools={()=>{}}/>));
 await act(async()=>host.querySelector('[aria-label="Line variants"]').click());
 const option=[...document.querySelectorAll('[role="menuitemradio"]')].find(b=>b.textContent.includes('Midpoint line'));
 expect(option).toBeTruthy();await act(async()=>option.click());
 expect(action).toHaveBeenLastCalledWith('sketch-midpoint-line');
 expect(document.querySelector('[role="menu"]')).toBeNull();
 const primary=host.querySelector('[data-tool-id="sketch-line"] .aui-ribbon-tool');
 expect(primary.textContent).toContain('Midpoint line');
 await act(async()=>primary.click());expect(action).toHaveBeenCalledTimes(2);
 await act(async()=>host.querySelector('[aria-label="Line variants"]').click());
 const original=[...document.querySelectorAll('[role="menuitemradio"]')].find(b=>b.textContent.trim()==='Line');
 await act(async()=>original.click());expect(action).toHaveBeenLastCalledWith('sketch-line');
 await act(async()=>root.unmount());host.remove();
});
it('shows distinct rectangle variant artwork inside the dropdown',async()=>{
 const {CADTraditionalRibbon}=await import('./CADTraditionalRibbon');const {createRoot}=await import('react-dom/client');const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 await act(async()=>root.render(<CADTraditionalRibbon activeWorkspace="sketch" sketchEditing documentName="Sketch" partOpen onSelectWorkspace={()=>{}} onAction={()=>{}} onUseFloatingTools={()=>{}}/>));
 await act(async()=>host.querySelector('[aria-label="Rectangle variants"]').click());const options=[...document.querySelectorAll('[role="menuitemradio"]')];expect(options).toHaveLength(3);const art=options.map(o=>o.querySelector('.aui-menu-icon svg')?.innerHTML);expect(art.every(Boolean)).toBe(true);expect(new Set(art).size).toBe(3);
 await act(async()=>root.unmount());host.remove();
});
it('dispatches the illustrated tangent arc choice from the arc dropdown',async()=>{
 const {CADTraditionalRibbon}=await import('./CADTraditionalRibbon');const {createRoot}=await import('react-dom/client');
 cadCommands.register('sketch-tangent-arc',()=>{});cadCommands.setEnabled('sketch-tangent-arc',true);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),action=vi.fn();
 await act(async()=>root.render(<CADTraditionalRibbon activeWorkspace="sketch" sketchEditing documentName="Sketch" partOpen onSelectWorkspace={()=>{}} onAction={action} onUseFloatingTools={()=>{}}/>));
 await act(async()=>host.querySelector('[aria-label="Arc variants"]').click());const choice=[...document.querySelectorAll('[role="menuitemradio"]')].find(b=>b.textContent==='Tangent arc');expect(choice.querySelector('svg')).toBeTruthy();await act(async()=>choice.click());expect(action).toHaveBeenCalledWith('sketch-tangent-arc');await act(async()=>root.unmount());host.remove();
});
