import {createRequire} from 'node:module';
import React,{act} from 'react';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect,vi} from 'vitest';
import {browserTabStorage} from '../cad-tab-session';
import {cadPresentation} from '../cad-presentation-store';
const host=vi.hoisted(()=>({activeProject:null,hostedDocumentName:()=>"Design.acad"}));
vi.mock('../host-library',()=>host);
const {JSDOM}=createRequire(import.meta.url)('jsdom');
let dom,root,container,Tabs;
beforeAll(async()=>{
 dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/cad/index.html?document=test',pretendToBeVisual:true});
 for(const k of ['window','document','navigator','HTMLElement','Element','Node','Event','localStorage','location'])vi.stubGlobal(k,dom.window[k]);
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 Tabs=(await import('./CADDocumentTabs')).CADDocumentTabs;
});
beforeEach(async()=>{localStorage.clear();window.sessionStorage.clear();window.name="";browserTabStorage();host.activeProject=null;cadPresentation.patch({workspaceMode:'modeling',partOpen:true,documentName:'Bracket',backendState:'ready'});container=document.createElement('div');document.body.append(container);root=(await import('react-dom/client')).createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});
const render=()=>act(async()=>root.render(<Tabs connection={{key:'test',name:'Bracket',flush:vi.fn()}}/>));
it('uses distinct type artwork for project tabs and keeps the project out of standalone history',async()=>{
 host.activeProject={parts:[{id:'p',name:'Part Studio'}],assemblies:[{id:'a',name:'Assembly'}]};
 browserTabStorage().setItem('aether-cad.open-files',JSON.stringify([{id:'test',name:'Loading draft'},{id:'other',name:'Other'}]));
 await render();
 const tabs=[...container.querySelectorAll('[role="tab"]')];
 expect(tabs.map(t=>t.querySelector('svg')?.getAttribute('data-design-kind'))).toEqual(['part','assembly']);
 expect(container.querySelector('.aui-file-icon')).toBeNull();
 expect(JSON.parse(browserTabStorage().getItem('aether-cad.open-files')).map(f=>f.id)).toEqual(['other']);
 expect(container.querySelector('.aui-document-tray-actions [aria-label="Part manager"]').getAttribute('aria-label')).toBe('Part manager');
});
it('retains the design kind of a standalone assembly beside a part',async()=>{
 browserTabStorage().setItem('aether-cad.open-files',JSON.stringify([{id:'part',name:'Bracket',kind:'part'}]));
 cadPresentation.patch({workspaceMode:'assembly',partOpen:false,documentName:'Mechanism'});
 await render();
 expect(JSON.parse(browserTabStorage().getItem('aether-cad.open-files')).at(-1).kind).toBe('assembly');
 expect([...container.querySelectorAll('[role="tab"] svg')].map(e=>e.getAttribute('data-design-kind'))).toEqual(['part','assembly']);
});

it('does not import another window’s legacy global open files',async()=>{
 localStorage.setItem('aether-cad.open-files',JSON.stringify([{id:'unrelated',name:'Other window'}]));
 await render();
 expect([...container.querySelectorAll('[role="tab"]')].map(t=>t.textContent)).toEqual(['Bracket']);
});

it('renders save state in the active tab rather than beside the strip',async()=>{
 await render();
 await act(async()=>document.dispatchEvent(new window.CustomEvent('aether-save-state',{detail:{phase:'saving',durable:false}})));
 const active=container.querySelector('[role="tab"][aria-selected="true"]');
 expect(active.querySelector('[role="status"]').textContent).toBe('Saving…');
 expect(container.querySelectorAll('.aui-document-tab-status')).toHaveLength(1);
 await act(async()=>document.dispatchEvent(new window.CustomEvent('aether-save-state',{detail:{phase:'saved',durable:true}})));
 expect(active.querySelector('[role="status"]').textContent).toBe('Saved');
});

it('keeps the hamburger in the document tray and revision after the part name',async()=>{
 await render();
 expect(container.querySelector('.aui-document-tray .cad-tab-document-controls [aria-label="Document controls"]')).toBeTruthy();
 expect(container.querySelector('.cad-document-header-group')).toBeNull();
 const tab=container.querySelector('.aui-document-tab');
 expect(tab.querySelector('.cad-tab-revision').textContent).toContain('V1.0');
 expect(tab.querySelector('.cad-tab-revision').previousElementSibling.getAttribute('role')).toBe('tab');
 expect(tab.querySelector('.cad-tab-revision').nextElementSibling.classList.contains('aui-tab-menu')).toBe(true);
});
