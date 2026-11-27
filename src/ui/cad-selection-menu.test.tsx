import {expect,it} from 'vitest';
import {selectionMenu} from './cad-selection-menu';
it('organizes supported methods and filters while preserving all command identities',()=>{
 const ids=['home-select-auto','selection-window-tool','selection-crossing-tool','selection-directional-tool','selection-clear-tool'];
 const input=ids.map(id=>({id,label:id,kind:'radio' as const,checked:false,disabled:false}));
 const menu=selectionMenu(input);
 expect(menu.map(item=>item.label)).toEqual(['Select','selection-window-tool','Selection Tools']);
 const leaves=menu.flatMap(item=>item.children??[item]);
 expect(leaves.map(item=>item.id).sort()).toEqual([...ids].sort());
});
it('leaves other tool menus untouched',()=>{const items=[{id:'solid-extrude',label:'Extrude'}];expect(selectionMenu(items)).toEqual(items);});

it('provides Freeform and Paint and no selection priority: one proximity rule, as Onshape',()=>{
 const ids=['home-select-auto','selection-window-tool','selection-freeform-tool','selection-paint-tool'];
 const menu=selectionMenu(ids.map(id=>({id,label:id})));
 expect(menu.map(item=>item.id)).toEqual(ids);
});
