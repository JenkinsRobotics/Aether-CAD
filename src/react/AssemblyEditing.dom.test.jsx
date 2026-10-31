// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { cadAssemblyWorkspace } from '../cad-assembly-workspace-store';
import { cadPresentation } from '../cad-presentation-store';
import { AssemblyMateDOFDialog } from './dialogs/mate-dof';
import { CADAssemblyPartsPanel } from './panels/parts';
import { AssemblyContactSetDialog } from './dialogs/contact-set';
import { AssemblyContactSets } from './panels/contact-sets';
import { CADHeaderControls } from './CADTraditionalRibbon';
import { cadCommands } from '../cad-command-registry';

let root, container, unlisten, actions, projection;
const rotation = { id:'turn', name:'rotation', kind:'rotation', state:'free', value_rad:Math.PI/4,
  value_m:null, limit_min_rad:-Math.PI/2, limit_max_rad:Math.PI/2, limit_min_m:null, limit_max_m:null };
const translation = { ...rotation, id:'travel', name:'translation', kind:'translation', value_rad:null,
  value_m:0.025, limit_min_rad:null, limit_max_rad:null, limit_min_m:-0.01, limit_max_m:0.04 };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('ResizeObserver',class { observe() {} disconnect() {} unobserve() {} });
  container=document.createElement('div'); document.body.append(container); root=createRoot(container);
  actions=[]; unlisten=cadPresentation.registerActionHandler(action=>{actions.push(action); return true;});
  projection={revision:'1',treeNodes:[],mateItems:[],connectorItems:[],relationItems:[],problemItems:[],bomRows:[],inspectorSections:[],commandAvailability:[],
    selectedMateDOF:rotation,selectedMateDOFs:[rotation,translation],
    instanceRows:[{id:'base',label:'Base'},{id:'pin',label:'Pin',dimmed:true}],summary:{instanceCount:2}};
  cadAssemblyWorkspace.setReady(projection);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();unlisten();cadAssemblyWorkspace.setUnavailable();vi.unstubAllGlobals();});
const render = mode => act(async()=>root.render(<AssemblyMateDOFDialog presentation={{...cadPresentation.snapshot(),startDialog:mode}}/>));
const choose = id => act(async()=>{const select=document.querySelector('#assembly-mate-coordinate');select.value=id;select.dispatchEvent(new Event('change',{bubbles:true}));});
const click = label => act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent===label || button.getAttribute('aria-label')===label).click());

it('chooses rotation or travel on the same mate with correct displayed and submitted units',async()=>{
  await render('set-mate-dof-value');
  expect(Number(document.querySelector('#assembly-mate-dof-value').value)).toBe(45);
  await choose('travel');
  expect(Number(document.querySelector('#assembly-mate-dof-value').value)).toBe(25);
  await click('Set Value');
  expect(actions.at(-1)).toMatchObject({type:'set-assembly-mate-dof-value',draft:{dofID:'travel',kind:'translation',value:0.025}});
  await choose('turn'); await click('Set Value');
  expect(actions.at(-1)).toMatchObject({draft:{dofID:'turn',kind:'rotation',value:45}});
});
it('loads each coordinate’s own limits and invalidates a draft when no free coordinate remains',async()=>{
  await render('edit-mate-dof-limits'); await choose('travel');
  expect(Number(document.querySelector('#assembly-mate-dof-minimum').value)).toBe(-10);
  expect(Number(document.querySelector('#assembly-mate-dof-maximum').value)).toBe(40);
  await click('Apply Limits');
  expect(actions.at(-1)).toMatchObject({type:'update-assembly-mate-dof-limits',draft:{dofID:'travel',minimum:-0.01,maximum:0.04}});
  await act(async()=>cadAssemblyWorkspace.setReady({...projection,revision:'2',selectedMateDOF:null,selectedMateDOFs:[]}));
  expect(document.querySelector('[role=alert]').textContent).toContain('no longer');
  expect([...document.querySelectorAll('button')].find(button=>button.textContent==='Apply Limits').disabled).toBe(true);
});
it('lists canonical occurrences, including hidden ones, and selects their actual IDs',async()=>{
  await act(async()=>root.render(<CADAssemblyPartsPanel/>));
  expect(container.textContent).toContain('Components (2)');
  expect(container.textContent).not.toContain('Create or import a solid');
  const row=[...container.querySelectorAll('[role=treeitem]')].find(row=>row.textContent.includes('Pin'));
  expect(row).toBeTruthy(); await act(async()=>row.click());
  expect([...cadAssemblyWorkspace.snapshot().selectedEntityIDs]).toEqual(['pin']);
});

it('edits contact membership without losing suppressed members and rejects an ABA-stale dialog',async()=>{
  const source={id:'contact',name:'Clearance',instance_ids:['base','pin'],suppressed:true};
  projection={...projection,contacts:{enabled:true,editable:true,sets:[source],selected:source,
    instances:[{id:'base',name:'Base',suppressed:false},{id:'pin',name:'Pin',suppressed:true}]}};
  await act(async()=>{cadAssemblyWorkspace.setReady(projection);root.render(<AssemblyContactSetDialog presentation={{...cadPresentation.snapshot(),startDialog:'edit-contact-set'}}/>);});
  expect(document.body.textContent).toContain('Pin (suppressed)');
  expect([...document.querySelectorAll('input[type=checkbox]')].every(input=>input.checked)).toBe(true);
  await click('Save Contact Set');
  expect(actions.at(-1)).toMatchObject({type:'update-assembly-contact-set',draft:{name:'Clearance',instanceIDs:['base','pin'],suppressed:true}});
  expect(actions.at(-1).source).toBe(source);
  await act(async()=>cadAssemblyWorkspace.setReady({...projection,contacts:{...projection.contacts,sets:[{...source}],selected:{...source}}}));
  expect(document.querySelector('[role=alert]').textContent).toContain('changed');
  expect([...document.querySelectorAll('button')].find(button=>button.textContent==='Save Contact Set').disabled).toBe(true);
});
it('shows contact state and refuses editing in a read-only dialog',async()=>{
  const source={id:'contact',name:'Clearance',instance_ids:['base','pin'],suppressed:true};
  projection={...projection,contacts:{enabled:false,editable:false,sets:[source],selected:source,
    instances:[{id:'base',name:'Base',suppressed:false},{id:'pin',name:'Pin',suppressed:true}]}};
  await act(async()=>{cadAssemblyWorkspace.setReady(projection);root.render(<><AssemblyContactSets/><AssemblyContactSetDialog presentation={{...cadPresentation.snapshot(),startDialog:'edit-contact-set'}}/></>);});
  expect(container.textContent).toContain('Contact checks off');expect(container.textContent).toContain('Suppressed');
  expect(document.querySelector('[role=alert]').textContent).toContain('unavailable');
  expect([...document.querySelectorAll('button')].find(button=>button.textContent==='Save Contact Set').disabled).toBe(true);
});
it('renders the contact actions menu and dispatches edits against the selected canonical set',async()=>{
  const source={id:'contact',name:'Clearance',instance_ids:['base','pin'],suppressed:false};
  projection={...projection,contacts:{enabled:true,editable:true,sets:[source],selected:source,
    instances:[{id:'base',name:'Base',suppressed:false},{id:'pin',name:'Pin',suppressed:false}]}};
  await act(async()=>{cadAssemblyWorkspace.setReady(projection);root.render(<AssemblyContactSets/>);});
  const trigger=document.querySelector('button[aria-label="Contact actions"]');expect(trigger).toBeTruthy();
  await act(async()=>trigger.click());
  const item=[...document.querySelectorAll('[role=menuitem]')].find(item=>item.textContent.includes('Suppress Selected Contact Set'));
  expect(item).toBeTruthy();await act(async()=>item.click());
  expect(actions.at(-1)).toMatchObject({type:'update-assembly-contact-set',draft:{suppressed:true,instanceIDs:['base','pin']}});
  expect(actions.at(-1).source).toBe(source);
});


it('routes common history buttons to the active document and sketch, and respects availability',async()=>{
  const ids=['part-undo','part-redo','assembly-undo-recipe','assembly-redo-recipe','sketch-undo','sketch-redo'];
  const called=[], cleanup=ids.map(id=>cadCommands.register(id,()=>called.push(id)));
  const oldMode=cadPresentation.snapshot().workspaceMode;
  const show=async(documentType,sketchEditing=false,partOpen=true)=>act(async()=>root.render(
    <CADHeaderControls documentType={documentType} sketchEditing={sketchEditing} partOpen={partOpen}/>));
  const undo=()=>[...container.querySelectorAll('button')].find(button=>button.getAttribute('aria-label')==='Undo');
  try {
    cadPresentation.patch({workspaceMode:'modeling'});ids.forEach(id=>cadCommands.setEnabled(id,true));
    await show('assembly',false,false);await click('Undo');await click('Redo');
    expect(called.splice(0)).toEqual(['assembly-undo-recipe','assembly-redo-recipe']);
    await act(async()=>cadCommands.setEnabled('assembly-undo-recipe',false));expect(undo().disabled).toBe(true);
    await show('part');await click('Undo');await click('Redo');
    expect(called.splice(0)).toEqual(['part-undo','part-redo']);
    await show('part',true);await click('Undo');await click('Redo');
    expect(called.splice(0)).toEqual(['sketch-undo','sketch-redo']);
    await show('project',false,false);expect(undo().disabled).toBe(true);
    await act(async()=>cadAssemblyWorkspace.setUnavailable());await show('assembly',false,false);expect(undo().disabled).toBe(true);
  } finally { cleanup.forEach(fn=>fn());cadPresentation.patch({workspaceMode:oldMode}); }
});
