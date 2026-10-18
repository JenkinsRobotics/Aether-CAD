// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {CADTabActionDialog} from './CADTabActionDialog';
const service=vi.hoisted(()=>({loadTabMetadata:vi.fn(),tabMetadataItem:vi.fn(),tabPartCode:vi.fn(),editTabProperties:vi.fn(),duplicateTab:vi.fn(),prepareTabDeletion:vi.fn(),deleteTab:vi.fn()}));
vi.mock('../document-tab-actions',()=>service);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
const target={id:'b',name:'Bracket B',kind:'part',current:false,documentId:'doc-b',itemId:'b'};
let root,host;
beforeEach(()=>{vi.resetAllMocks();service.loadTabMetadata.mockResolvedValue({revision:8,writable:true,settings:{units:{length:{unit:'in'}}}});service.tabMetadataItem.mockReturnValue({name:'Bracket B',description:'existing description',category:'Hardware'});service.prepareTabDeletion.mockResolvedValue({});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(()=>root.unmount());host.remove();});
async function mount(action,flush=vi.fn(async()=>{})) {const applied=vi.fn(),close=vi.fn();await act(async()=>root.render(<CADTabActionDialog target={target} action={action} flush={flush} onClose={close} onApplied={applied}/>));return {applied,close,flush};}
const click=async label=>act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent===label).click());
it('flushes before loading the clicked tab, shows its units and preserves values on save',async()=>{
 const order=[];service.loadTabMetadata.mockImplementation(async()=>{order.push('load');return {revision:8,writable:true,settings:{units:{length:{unit:'in'}}}}});
 const {applied}=await mount('properties',vi.fn(async()=>{order.push('flush');}));
 expect(order).toEqual(['flush','load']);expect(document.body.textContent).toContain('in');expect(document.body.textContent).toContain('Properties — Bracket B');
 await click('Save');expect(service.editTabProperties).toHaveBeenCalledWith(target,expect.objectContaining({revision:8}),{name:'Bracket B',description:'existing description',category:'Hardware'},false);
 expect(applied).toHaveBeenCalledWith(expect.objectContaining({target,action:'properties'}));
});
it('does not load or mutate when saving the current editor fails',async()=>{
 await mount('rename',vi.fn(async()=>{throw Error('Save conflict');}));expect(document.querySelector('[role="alert"]').textContent).toBe('Save conflict');expect(service.loadTabMetadata).not.toHaveBeenCalled();
 expect([...document.querySelectorAll('button')].find(b=>b.textContent==='Save').disabled).toBe(true);
});
it('requires an explicit deletion confirmation and leaves the dialog open on dependency failure',async()=>{
 service.deleteTab.mockRejectedValue(Error('Remove dependent Assembly instances first.'));
 const {applied}=await mount('delete');expect(service.deleteTab).not.toHaveBeenCalled();
 await click('Delete');expect(service.deleteTab).toHaveBeenCalledWith(target,expect.objectContaining({revision:8}),{});
 expect(document.querySelector('[role="alert"]').textContent).toContain('dependent');expect(applied).not.toHaveBeenCalled();
});
it('provides a selectable fallback when clipboard access is denied',async()=>{
 service.tabPartCode.mockResolvedValue('{"name":"Bracket B"}');Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:vi.fn(async()=>{throw Error('denied');})}});
 await mount('clipboard');expect(document.querySelector('textarea').value).toContain('Bracket B');expect(document.body.textContent).toContain('copy it with your keyboard');
 expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{"name":"Bracket B"}');
});
it('keeps a read-only tab inspectable while disabling edits',async()=>{
 service.loadTabMetadata.mockResolvedValue({revision:3,writable:false,settings:{units:{length:{unit:'mm'}}}});
 await mount('properties');expect(document.querySelector('#tab-action-name').disabled).toBe(true);expect([...document.querySelectorAll('button')].find(b=>b.textContent==='Save').disabled).toBe(true);
});
