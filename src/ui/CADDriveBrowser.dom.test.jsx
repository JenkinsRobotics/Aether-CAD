// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const mocks = vi.hoisted(()=>({request:vi.fn()}));
vi.mock('@aether/session/library/drive-api',()=>({
  driveRequest:mocks.request,editorURL:()=>'/cad/',fileIcon:()=> 'folder',fileType:()=> 'Folder',
}));
import {CADDriveBrowser} from './CADDriveBrowser';
let root,container;
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  mocks.request.mockImplementation(async action=> action==='context'
    ? {user:{id:'u'},organizations:[{id:'o',name:'Org'}],workspaces:[]}
    : {files:[{id:'f',name:'Fixtures',kind:'folder',owner_id:'u',organization:'o',workspace:null}],path:[]});
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.clearAllMocks();vi.unstubAllGlobals();});
const fire = (element,type,options={})=>act(async()=>element.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,...options})));
const labels = ()=>[...document.querySelectorAll('[role="menuitem"] .aui-menu-label')].map(el=>el.textContent);
const close = ()=>act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
it('Drive shares row menus and background creation without app actions or folder downloads',async()=>{
  await act(async()=>root.render(<CADDriveBrowser documentID={null} connection={{flush:vi.fn()}}/>));
  const row=container.querySelector('[data-drive-id="f"]');expect(row).toBeTruthy();
  await fire(row,'contextmenu');const context=labels();expect(context).toEqual(['Open folder','Details and sharing in Drive…']);
  await close();await fire(container.querySelector('[aria-label="Options for Fixtures"]'),'click');expect(labels()).toEqual(context);
  await close();await fire(container.querySelector('[aria-label="Create in Drive"]'),'click');const creation=labels();
  await close();await fire(container.querySelector('.aui-tab-browser-items'),'contextmenu');
  expect(labels()).toEqual([...creation,'Refresh','Open Aether Drive']);
  expect(labels().join('|')).not.toMatch(/Undo|Redo|settings/);
  const refresh=[...document.querySelectorAll('[role="menuitem"]')].find(el=>el.textContent==='Refresh');
  await fire(refresh,'click');expect(mocks.request.mock.calls.filter(([action])=>action==='list')).toHaveLength(2);
  expect(container.querySelector('[aria-label="Refresh Drive"]')).toBeNull();
});
