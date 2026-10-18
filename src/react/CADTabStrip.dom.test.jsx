// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,test,vi} from 'vitest';
import {CADTabStrip} from './CADTabStrip';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
let root, host;
afterEach(async()=>{if(root)await act(()=>root.unmount());host?.remove();vi.restoreAllMocks();});
async function mount() {
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 const reorder=vi.fn(),detach=vi.fn(),select=vi.fn();
 await act(()=>root.render(<CADTabStrip tabs={[{id:'a',label:'Part A',current:true},{id:'b',label:'Part B',onSelect:select}]} placement="bottom" label="Files" onAdd={()=>{}} onReorder={reorder} onDetach={detach}/>));
 const strip=host.firstElementChild;
 strip.setPointerCapture=()=>{};strip.hasPointerCapture=()=>false;
 strip.getBoundingClientRect=()=>({top:100,bottom:132});
 return {strip,reorder,detach,select,tabs:[...host.querySelectorAll('[role="tab"]')]};
}
async function pointer(element,type,x,y){await act(()=>element.dispatchEvent(new MouseEvent(type,{bubbles:true,clientX:x,clientY:y,button:0})));}
test('dragging reorders without selecting and supports keyboard reorder',async()=>{
 const {strip,reorder,select,tabs}=await mount();
 document.elementFromPoint=()=>tabs[1];
 await pointer(tabs[0],'pointerdown',10,110);await pointer(strip,'pointermove',200,110);await pointer(strip,'pointerup',200,110);
 expect(reorder).toHaveBeenCalledWith('a','b');
 expect(select).not.toHaveBeenCalled();
 await act(()=>tabs[0].dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'ArrowRight',altKey:true})));
 expect(reorder).toHaveBeenCalledTimes(2);
});
test('tear-off emits the selected ID; Escape cancels drag',async()=>{
 const {strip,detach,tabs}=await mount();document.elementFromPoint=()=>strip;
 await pointer(tabs[0],'pointerdown',10,110);await pointer(strip,'pointermove',200,10);await pointer(strip,'pointerup',200,10);
 expect(detach).toHaveBeenCalledWith('a');
 await act(()=>strip.dispatchEvent(new MouseEvent('click',{bubbles:true})));
 await pointer(tabs[0],'pointerdown',10,110);await pointer(strip,'pointermove',200,10);
 await act(()=>tabs[0].dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Escape'})));
 await pointer(strip,'pointerup',200,10);expect(detach).toHaveBeenCalledTimes(1);
});
test('folder collapse keeps the active tab reachable',async()=>{
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 const change=vi.fn();
 await act(()=>root.render(<CADTabStrip tabs={[{id:'a',label:'Part A',current:true},{id:'b',label:'Part B'}]} folders={[{id:'g',name:'Hardware',tabs:['a','b'],collapsed:true}]} onFoldersChange={change} placement="bottom" label="Files" onAdd={()=>{}} onReorder={()=>{}} onDetach={()=>{}}/>));
 expect([...host.querySelectorAll('[role="tab"]')].map(t=>t.textContent)).toEqual(['Part A']);
 const folder=host.querySelector('.cad-tab-folder-label');
 await act(()=>folder.click());expect(change.mock.calls[0][0][0].collapsed).toBe(false);
});
test('dropping onto a folder moves tab membership without selecting it',async()=>{
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 const change=vi.fn(),select=vi.fn();
 await act(()=>root.render(<CADTabStrip tabs={[{id:'a',label:'Part A',current:true,onSelect:select}]} folders={[{id:'g',name:'Hardware',tabs:[],collapsed:false}]} onFoldersChange={change} placement="bottom" label="Files" onAdd={()=>{}} onReorder={()=>{}} onDetach={()=>{}}/>));
 const strip=host.firstElementChild;strip.setPointerCapture=()=>{};strip.hasPointerCapture=()=>false;strip.getBoundingClientRect=()=>({top:100,bottom:132});
 document.elementFromPoint=()=>host.querySelector('.cad-tab-folder-label');
 await pointer(host.querySelector('[role="tab"]'),'pointerdown',10,110);await pointer(strip,'pointermove',200,110);await pointer(strip,'pointerup',200,110);
 expect(change.mock.calls[0][0][0].tabs).toEqual(['a']);expect(select).not.toHaveBeenCalled();
});

test('tab chevrons open actions without selecting and plus keeps a separate menu',async()=>{
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 const select=vi.fn(),close=vi.fn(),add=vi.fn(),manage=vi.fn(),detach=vi.fn();
 await act(()=>root.render(<CADTabStrip tabs={[{id:'a',label:'Part A',current:true},{id:'b',label:'Part B',onSelect:select,onClose:close}]} placement="bottom" label="Files" onAdd={add} onManage={manage} onReorder={()=>{}} onDetach={detach}/>));
 const button=label=>host.querySelector(`[aria-label="${label}"]`);
 await act(()=>button('Options for Part B').click());
 expect(select).not.toHaveBeenCalled();
 const menuItem=label=>[...document.querySelectorAll('[role="menuitem"]')].find(item=>item.textContent.includes(label));
 await act(()=>menuItem('Close tab').click());expect(close).toHaveBeenCalledOnce();
 await act(()=>button('Create new design').click());expect(add).toHaveBeenCalledOnce();
 await act(()=>button('Add options').click());
 await act(()=>menuItem('Manage and import files').click());expect(manage).toHaveBeenCalledOnce();
});

test('right click and keyboard menus use the clicked inactive tab without selecting it',async()=>{
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 const select=vi.fn(),action=vi.fn();
 await act(()=>root.render(<CADTabStrip tabs={[{id:'a',label:'Part A',current:true},{id:'b',label:'Part B',onSelect:select}]} placement="bottom" label="Files" onAdd={()=>{}} onReorder={()=>{}} onDetach={()=>{}}
   tabActions={id=>[{id:'rename',label:`Rename ${id}`}]} onTabAction={action}/>));
 const tab=host.querySelectorAll('[role="tab"]')[1];
 const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:140,clientY:930});
 await act(()=>tab.dispatchEvent(event));
 expect(event.defaultPrevented).toBe(true);expect(select).not.toHaveBeenCalled();
 expect(document.querySelector('[role="menu"]').getAttribute('aria-label')).toBe('Tab options for Part B');
 await act(()=>[...document.querySelectorAll('[role="menuitem"]')].find(b=>b.textContent.includes('Rename b')).click());
 expect(action).toHaveBeenCalledWith('b','rename');
 await act(()=>tab.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true})));
 expect(document.querySelector('[role="menu"]')).toBeTruthy();
 await act(()=>document.querySelector('[role="menuitem"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(document.querySelector('[role="menu"]')).toBeNull();expect(document.activeElement).toBe(tab);
 await act(()=>host.querySelector('[aria-label="Options for Part B"]').click());
 expect([...document.querySelectorAll('[role="menuitem"]')].some(b=>b.textContent.includes('Rename b'))).toBe(true);
 expect(select).not.toHaveBeenCalled();
});
