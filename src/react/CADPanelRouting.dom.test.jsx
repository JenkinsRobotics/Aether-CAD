import { createRequire } from 'node:module';
import React, { act } from 'react';
import { beforeAll, beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest';
import { cadPresentation } from '../cad-presentation-store';
import { cadWorkspace } from '../cad-workspace-store';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
let root, container, Shell, unlisten, dom;
const fileTrayPreference = 'aether-cad.file-tray-visible';
beforeAll(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {url:'http://localhost/cad/index.html', pretendToBeVisual:true});
  for (const key of ['window','document','navigator','HTMLElement','Element','Node','HTMLInputElement','Event','MouseEvent','KeyboardEvent','localStorage','location']) vi.stubGlobal(key,dom.window[key]);
  vi.stubGlobal('getComputedStyle',dom.window.getComputedStyle.bind(dom.window));
  vi.stubGlobal('requestAnimationFrame',dom.window.requestAnimationFrame.bind(dom.window));
  vi.stubGlobal('cancelAnimationFrame',dom.window.cancelAnimationFrame.bind(dom.window));
  vi.stubGlobal('ResizeObserver',class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  Shell=(await import('./AetherCADShell')).AetherCADShell;
});
beforeEach(async () => {
  localStorage.removeItem(fileTrayPreference);
  cadPresentation.patch({partOpen:true,activePanel:'items',startScreen:'workspace',workspaceMode:'modeling',workspaceLayout:'docked',panelPlacements:{browser:'docked',inspector:'docked',bottom:'hidden'}});
  unlisten=cadPresentation.registerActionHandler(action => {
    if(action.type==='set-panel-placement') cadPresentation.patch({panelPlacements:{...cadPresentation.snapshot().panelPlacements,[action.panel]:action.placement}});
    if(action.type==='select-panel') cadPresentation.patch({activePanel:action.panel});
    if(action.type==='show-start-dialog') cadPresentation.patch({startDialog:action.dialog});
    if(action.type==='close-start-dialog') cadPresentation.patch({startDialog:null});
  });
  container=document.createElement('div');document.body.append(container);
  const {createRoot}=await import('react-dom/client'); root=createRoot(container);
  await act(async()=>root.render(<Shell/>));
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();unlisten();vi.restoreAllMocks();localStorage.removeItem(fileTrayPreference);});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});
const railButton = label => [...container.querySelectorAll('.aui-tabbed-sidebar-tabs button, .aui-studio-aux-toolbar button')].find(b=>b.getAttribute('aria-label')===label);
async function click(label){const button=railButton(label);expect(button).toBeTruthy();await act(async()=>button.click());}
// Exiting shared panels remain painted briefly but are no longer presented or interactive.
function isVisible(node) { return !!node && !node.closest('[hidden], [aria-hidden="true"], [inert]'); }
it('retains the same camera navigation through sketch entry and exit', async()=>{
  const cameraButton=container.querySelector('[aria-label="Camera view"]');
  if (cameraButton.getAttribute('aria-expanded') !== 'true') await act(async()=>cameraButton.click());
  const cube=document.querySelector('#view-cube');
  expect(cube).toBeTruthy();
  for(const editing of [true,false,true,false]) {
    await act(async()=>window.dispatchEvent(new window.CustomEvent('aether-sketch-mode',{detail:editing})));
    expect(document.querySelector('#view-cube')).toBe(cube);
    expect(container.querySelector('[aria-label="Camera view"]')).toBe(cameraButton);
    expect(isVisible(cube)).toBe(true);
  }
});
it('toggles the same view cube directly and persists visibility independently of the document', async()=>{
  const toggle=container.querySelector('[aria-label="Camera view"]');
  const cube=container.querySelector('#view-cube');
  expect(toggle).toBeTruthy();
  if (toggle.getAttribute('aria-expanded') !== 'true') await act(async()=>toggle.click());
  expect(isVisible(cube)).toBe(true);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  await act(async()=>toggle.click());
  expect(isVisible(cube)).toBe(false);
  expect(localStorage.getItem('aether-cad.view-cube-visible')).toBe('false');
  await act(async()=>toggle.click());
  expect(container.querySelector('#view-cube')).toBe(cube);
  expect(isVisible(cube)).toBe(true);
  expect(localStorage.getItem('aether-cad.view-cube-visible')).toBe('true');
  localStorage.removeItem('aether-cad.view-cube-visible');
});
it('keeps the pinned Feature tree beside History and Version control, which replace each other', async()=>{
  expect(isVisible(container.querySelector('[data-panel="items"]'))).toBe(true);
  await click('Version control');
  await act(async()=>[...container.querySelectorAll('[role="radio"]')].find(button=>button.textContent==='History').click());
  expect(isVisible(container.querySelector('[aria-label="Editing history"]'))).toBe(true);
  expect(isVisible(container.querySelector('[data-panel="items"]'))).toBe(true);
  const versionsTab=[...container.querySelectorAll('[role="radio"]')].find(button=>button.textContent==='Version control');
  await act(async()=>versionsTab.click());
  expect(isVisible(container.querySelector('[aria-label="Versions and history"]'))).toBe(true);
  expect(isVisible(container.querySelector('[aria-label="Editing history"]'))).toBe(false);
  expect(isVisible(container.querySelector('[data-panel="items"]'))).toBe(true);
  await click('Version control');
  expect(isVisible(container.querySelector('[aria-label="Versions and history"]'))).toBe(false);
  expect(isVisible(container.querySelector('[data-panel="items"]'))).toBe(true);
});
it('opens Files as a left panel and moves the part tray toggle to the view tools', async()=>{
  await click('Files');
  const files=container.querySelector('.aui-tab-browser');
  expect(isVisible(files)).toBe(true);
  expect(files.textContent).toContain('Part Studio');
  expect(isVisible(container.querySelector('[data-panel="items"]'))).toBe(true);
  await click('Comments');
  expect(isVisible(container.querySelector('.aui-tab-browser'))).toBe(false);
  const tray=()=>container.querySelector('.cad-document-tray-slot');
  const toggle=container.querySelector('.cad-studio-view-tools button[aria-label="Part tray"]');
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  expect(tray().hidden).toBe(true);
  await act(async()=>toggle.click());
  expect(tray().hidden).toBe(false);
  await act(async()=>container.querySelector('.cad-studio-view-tools button[aria-label="Part tray"]').click());
  expect(tray().hidden).toBe(true);
});

async function remountShell() {
  await act(async()=>root.render(null));
  await act(async()=>root.render(<Shell/>));
}
const fileTray = () => container.querySelector('.cad-document-tray-slot');
const fileTrayToggle = () => container.querySelector('.cad-studio-view-tools button[aria-label="Part tray"]');

it('keeps the file tray closed by default and remembers explicit choices across editor remounts', async()=>{
  expect(fileTray().hidden).toBe(true);
  expect(localStorage.getItem(fileTrayPreference)).toBeNull();
  for (const visible of [true, false]) {
    await act(async()=>fileTrayToggle().click());
    expect(fileTray().hidden).toBe(!visible);
    expect(localStorage.getItem(fileTrayPreference)).toBe(String(visible));
    await remountShell();
    expect(fileTray().hidden).toBe(!visible);
    expect(fileTrayToggle().getAttribute('aria-pressed')).toBe(String(visible));
    await act(async()=>cadPresentation.patch({partOpen:false}));
    await act(async()=>cadPresentation.patch({partOpen:true}));
    await click('Files');
    await click('Comments');
    expect(fileTray().hidden).toBe(!visible);
  }
});

it.each(['false', '', 'invalid'])('does not open the file tray for a stored %j value', async value=>{
  localStorage.setItem(fileTrayPreference, value);
  await remountShell();
  expect(fileTray().hidden).toBe(true);
  expect(fileTrayToggle().getAttribute('aria-pressed')).toBe('false');
});

it('defaults the file tray closed and permits manual toggling when browser storage is blocked', async()=>{
  for (const method of ['getItem', 'setItem']) {
    const original = dom.window.Storage.prototype[method];
    vi.spyOn(dom.window.Storage.prototype, method).mockImplementation(function(key, ...args) {
      if (key === fileTrayPreference) throw new Error('Storage blocked');
      return original.call(this, key, ...args);
    });
  }
  await remountShell();
  expect(fileTray().hidden).toBe(true);
  await act(async()=>fileTrayToggle().click());
  expect(fileTray().hidden).toBe(false);
  await act(async()=>fileTrayToggle().click());
  expect(fileTray().hidden).toBe(true);
});
it('ribbon category changes preserve the chosen left view and right appearance is independent',async()=>{
  await click('Version control');
  await act(async()=>[...container.querySelectorAll('[role="radio"]')].find(button=>button.textContent==='History').click());
  for(const label of ['Solid','Surface','Manage','Output']) {
    const tab=[...container.querySelectorAll('.aui-workspace-ribbon [role="tab"]')].find(button=>button.textContent===label);
    expect(tab).toBeTruthy();await act(async()=>tab.click());
    expect(isVisible(container.querySelector('[aria-label="Editing history"]'))).toBe(true);
    expect(cadPresentation.snapshot().activePanel).toBe('items');
  }
  await click('Material properties');
  const appearance=container.querySelector('[data-panel="visualization"]');
  expect(isVisible(appearance)).toBe(true);
  expect(appearance.closest('.aui-shell-side--right')).toBeTruthy();
  expect(isVisible(container.querySelector('[aria-label="Editing history"]'))).toBe(true);
  await click('Configurations');
  expect(isVisible(appearance)).toBe(false);
  expect(isVisible(container.querySelector('[data-panel="configurations"]'))).toBe(true);
});

it('right-click on a feature row offers its real controls without generic or placeholder commands', async () => {
  const { cadWorkspace } = await import('../cad-workspace-store');
  await act(async () => cadWorkspace.publish({
    itemNodes: [{ id: 'feature/sketch/s1', label: 'Sketch 1', actions: [{ id: 'edit-feature', label: 'Edit Sketch 1', icon: '✎' }] }],
    selectedItemIDs: new Set(), expandedItemIDs: new Set(), historyItems: [], historyNodes: [], rollbackIndex: 0,
    connectorItems: [], mateItems: [], problemItems: [], inspectorSections: [], selectedConnectorIDs: new Set(), partCount: 1,
  }));
  const row = [...container.querySelectorAll('.aui-tree-row')].find((el) => el.textContent.includes('Sketch 1'));
  expect(row).toBeTruthy();
  await act(async () => row.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 120 })));
  const menu = document.querySelector('[role="menu"]');
  expect(menu).toBeTruthy();
  const menuItem = (label) => [...menu.querySelectorAll('[role="menuitem"],[role="menuitemradio"]')].find((el) => el.textContent.includes(label));
  expect(menuItem('Rename')).toBeTruthy();
  expect(menuItem('Edit…')).toBeTruthy();
  expect(menuItem('Show dependencies…')).toBeUndefined();
  expect(menuItem('Undo sketch')).toBeUndefined();
  expect(menuItem('Aether CAD settings')).toBeUndefined();
  const actions = [];
  const stop = cadWorkspace.registerActionHandler((a) => actions.push(a));
  await act(async () => menuItem('Edit…').click());
  expect(actions.at(-1)).toEqual({ type: 'item-action', id: 'feature/sketch/s1', actionID: 'edit-feature' });
  expect(document.querySelector('[role="menu"]')).toBeNull();
  stop();
});

// Delete over the tree is the only way to remove a feature without opening its
// dialog, so the key has to reach an action — and must not steal Backspace from
// a row being renamed.
it('sends Delete over the feature tree to the selected feature, but not from a rename field', async () => {
  const actions = [];
  const unregister = cadWorkspace.registerActionHandler(action => { actions.push(action); });
  await act(async () => cadWorkspace.publish({
    ...cadWorkspace.snapshot(),
    itemNodes: [{ id: 'feature/extrude/e1', label: 'Extrude 1' }],
    selectedItemIDs: new Set(['feature/extrude/e1']),
  }));
  const list = container.querySelector('#parts-list');
  const press = target => act(async () => target.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
  ));
  await press(list.querySelector('[role="treeitem"][aria-selected="true"]'));
  expect(actions).toContainEqual({ type: 'item-action', id: 'feature/extrude/e1', actionID: 'delete-feature' });

  actions.length = 0;
  const field = document.createElement('input');
  list.append(field);
  await press(field);
  expect(actions).toEqual([]);
  unregister();
});

it('shows under-defined badges in the Feature tree and updates each sketch independently', async()=>{
 const {createEmptyPartDocument}=await import('@aether/core/document');
 const {buildCADWorkspaceProjection}=await import('../cad-workspace-projection');
 const doc=createEmptyPartDocument('Sketch badge acceptance');
 doc.features=['s1','s2'].map((id,index)=>({id,type:'profile',name:`Sketch ${index+1}`,plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{type:'circle',center:[0,0],radius:5}],constraints:[]}}));
 const publish=async()=>{const projection=buildCADWorkspaceProjection(doc,[],new Set(),{},null,[],[],null,{faceCount:0,candidateCount:0},new Set());await act(async()=>cadWorkspace.publish(projection));};
 await publish();
 const tree=container.querySelector('[data-panel="items"]');
 expect(isVisible(tree)).toBe(true);
 expect(tree.querySelectorAll('.cad-tree-icon--under-constrained')).toHaveLength(2);
 expect(tree.querySelector('[title="Under-defined sketch"]')).toBeTruthy();
 doc.features[0].profile.constraints=[{id:'center',kind:'fix',a:{kind:'point',contour:0,index:0},point:[0,0]},{id:'radius',kind:'radius',a:{kind:'circle',contour:0},value:5}];
 await publish();
 expect(tree.querySelectorAll('.cad-tree-icon--under-constrained')).toHaveLength(1);
 const badge=tree.querySelector('.cad-tree-icon--under-constrained');
 expect(badge.closest('[role="treeitem"]').textContent).toContain('Sketch 2');
 doc.rollbackIndex=1;doc.features[1].suppressed=true;
 await publish();
 expect(tree.querySelectorAll('.cad-tree-icon--under-constrained')).toHaveLength(1);
 expect(tree.querySelector('[aria-label="Unsuppress Sketch 2"]')).toBeTruthy();
 expect(tree.querySelector('.cad-tree-icon--under-constrained').closest('[role="treeitem"]').textContent).not.toContain('Suppressed');
});

it.each(['suite','classic'])('floating %s rails keep the feature tree alongside one auxiliary and one properties panel', async(theme)=>{
  if(theme==='classic') {
    await act(async()=>root.unmount());
    localStorage.setItem('aether-cad.chrome.studio-v1','classic');
    const {createRoot}=await import('react-dom/client');root=createRoot(container);
    await act(async()=>root.render(<Shell/>));
    localStorage.removeItem('aether-cad.chrome.studio-v1');
  }
  await act(async()=>cadPresentation.patch({workspaceLayout:'expanded'}));
  // Studio zones: the aux toolbar holds only the chosen aux items (Settings › Layout);
  // the feature tree is the standard left column and never one of its buttons.
  const left=['Comments','AI advisor','Version control','Files'];
  expect(container.querySelector('[aria-label="Left sidebar"] [aria-label="Part manager"]')).toBeNull();
  for(const label of ['Features and parts','Document notes','Reminders','Create version']) expect(railButton(label)).toBeUndefined();
  const right=['Properties','Configurations','Assembly','Inspect','Material properties','Rendering environment','Camera and display','Performance'];
  const active=labels=>labels.filter(label=>railButton(label)?.getAttribute('aria-pressed')==='true');
  const tree=()=>container.querySelector('[data-panel="items"]');
  const visiblePanels=side=>[...container.querySelectorAll(`[aria-label="${side} sidebar"] .aui-shell-panel, .aui-studio-aux-sidebar .aui-shell-panel`)].filter(isVisible).filter(panel=>!panel.contains(tree()));
  const itemTree=tree();
  for(const label of left) {
    await click(label);
    expect(active(left)).toEqual([label]);
    expect(active(right)).toEqual(['Properties']);
    expect(visiblePanels('Left')).toHaveLength(1);
    expect(isVisible(tree())).toBe(true);
  }
  for(const label of right.slice(1)) {
    await click(label);
    expect(active(right)).toEqual([label]);
    expect(active(left)).toEqual([left.at(-1)]);
    expect(isVisible(tree())).toBe(true);
  }
  // Switching retains portal content rather than creating a second panel copy.
  expect(tree()).toBe(itemTree);
  await click(left.at(-1));
  expect(active(left)).toEqual([]);
  expect(active(right)).toEqual(['Performance']);
  expect(isVisible(tree())).toBe(true);
  await click('Comments');
  // Aux cards close from the aux toolbar; they have no float/close chrome.
  expect(container.querySelector('[aria-label="Close Comments"]')).toBeNull();
  expect(container.querySelector('[aria-label="Float Comments"]')).toBeNull();
  await click('Comments');
  expect(active(left)).toEqual([]);
  expect(isVisible(tree())).toBe(true);
});

/** Reach row commands through the same menu a person opens on that item. */
async function rowCommand(row, label) {
  await act(async () => row.dispatchEvent(new dom.window.MouseEvent('contextmenu', {bubbles:true,clientX:20,clientY:20})));
  return [...document.querySelectorAll('[role="menuitem"]')].find(el => el.querySelector('.aui-menu-label')?.textContent === label) ?? null;
}

it('uses one header for commands while row state and context actions preserve the CAD contract', async () => {
  const actions = [];
  const unregister = cadWorkspace.registerActionHandler(action => actions.push(action));
  const node = (id, label, suppressed = false) => ({ id, label, badge: suppressed ? 'Suppressed' : undefined,
    actions: [{ id: 'edit-feature', label: `Edit ${label}`, icon: 'e' }, { id: 'suppress-feature', label: `${suppressed ? 'Unsuppress' : 'Suppress'} ${label}`, icon: 's' }, { id: 'rollback-before', label: `Roll back before ${label}`, icon: 'r' }] });
  await act(async () => cadWorkspace.publish({ ...cadWorkspace.snapshot(),
    itemNodes: [node('feature/sketch/s1', 'Sketch 1'), node('feature/plane/p1', 'Plane 1', true), {id:'rollback-bar',label:'Rollback',variant:'divider'}],
    historyNodes: [node('feature/sketch/s1', 'Sketch 1'), node('feature/plane/p1', 'Plane 1', true)],
    selectedItemIDs: new Set(['feature/sketch/s1']), expandedItemIDs: new Set(), historyItems:[{id:'history/feature/s1',label:'Sketch 1'},{id:'history/feature/p1',label:'Plane 1'}],
    bodyNodes: [{id:'bodies',label:'Bodies',children:[{id:'feature/body/b1',label:'Body 1',actions:[{id:'body-visibility',label:'Show Body 1',icon:'v',pinned:true}]}]}],
  }));
  const tree = container.querySelector('[aria-label="CAD features"]');
  expect(tree.querySelector('[aria-label="Edit Sketch 1"]')).toBeNull();
  expect(tree.textContent).not.toContain('Body 1');
  expect(container.querySelector('[aria-label="CAD parts"]').textContent).toContain('Body 1');
  expect(container.querySelector('[role="separator"][aria-label="Resize Features and Parts"]')).toBeTruthy();
  expect(tree.querySelector('[aria-label="Unsuppress Plane 1"]')).toBeTruthy();
  const selectedRow = tree.querySelector('[aria-selected="true"]');
  await act(async () => (await rowCommand(selectedRow, 'Move down')).click());
  expect(actions).toContainEqual({type:'move-item',id:'feature/sketch/s1',targetID:'feature/plane/p1',position:'after'});
  await act(async () => tree.querySelector('[aria-label="Unsuppress Plane 1"]').click());
  expect(actions).toContainEqual({type:'item-action',id:'feature/plane/p1',actionID:'suppress-feature'});
  const row = [...tree.querySelectorAll('[role="treeitem"]')].find(el=>el.textContent.includes('Sketch 1'));
  await act(async () => row.dispatchEvent(new dom.window.MouseEvent('contextmenu',{bubbles:true,clientX:20,clientY:20})));
  const rollback = [...document.querySelectorAll('[role="menuitem"]')].find(el=>el.textContent.includes('Roll before'));
  expect(rollback).toBeTruthy();
  await act(async () => rollback.click());
  expect(actions).toContainEqual({type:'rollback-to',index:0});
  unregister();
});

it('selects folders for row commands and lets external geometry selection take over', async () => {
  const actions = [];
  const unregister = cadWorkspace.registerActionHandler(action => actions.push(action));
  const snapshot = { ...cadWorkspace.snapshot(), itemNodes: [{ id:'folder/f1', label:'Folder 1', children:[] }, {id:'feature/sketch/s1',label:'Sketch 1'}], bodyNodes:[], selectedItemIDs:new Set(['feature/sketch/s1']) };
  await act(async()=>cadWorkspace.publish(snapshot));
  const row = [...container.querySelectorAll('[role="treeitem"]')].find(el=>el.textContent.includes('Folder 1'));
  await act(async()=>row.click());
  expect(row.getAttribute('aria-selected')).toBe('true');
  const rename = await rowCommand(row, 'Rename');
  expect(rename.disabled).toBe(false);
  await act(async()=>rename.click()); expect(actions).toContainEqual({type:'item-action',id:'folder/f1',actionID:'folder-rename'});
  await act(async()=>cadWorkspace.publish({...snapshot,selectedItemIDs:new Set()}));
  expect(row.getAttribute('aria-selected')).toBe('false');
  await act(async()=>cadWorkspace.publish(snapshot));
  expect(row.getAttribute('aria-selected')).toBe('false');
  unregister();
});

it('shows draft and assembly states as accessible SVG icons rather than status words', async () => {
  await act(async()=>cadWorkspace.publish({...cadWorkspace.snapshot(),
    itemNodes: ['Editing','No plane','Fastened','Free','Rolled back','Error','—'].map((badge,index)=>({id:`state/${index}`,label:`Item ${index}`,badge})),
    bodyNodes:[], selectedItemIDs:new Set(),
  }));
  const tree = container.querySelector('[aria-label="CAD features"]');
  for (const label of ['Editing sketch','No sketch plane','Fastened','Free to move','Rolled back','Feature error','Unavailable']) {
    expect(tree.querySelector(`[role="img"][aria-label="${label}"] svg`)).toBeTruthy();
    expect(tree.textContent).not.toContain(label);
  }
});

it('routes each right rail tool to its own panel without duplicate view trays', async () => {
  for (const label of ['Orientation', 'Display', 'Scene', 'Material', 'Ground', 'Panels', 'Parameters', 'Appearance', 'View']) expect(railButton(label)).toBeUndefined();
  const routes = [['Material properties','visualization'], ['Rendering environment','rendering'], ['Camera and display','view'], ['Configurations','configurations']];
  for (const [label,id] of routes) {
    await click(label);
    expect(isVisible(container.querySelector(`[data-panel="${id}"]`))).toBe(true);
    for (const [,other] of routes) if (other !== id) expect(isVisible(container.querySelector(`[data-panel="${other}"]`))).toBe(false);
  }
  expect(railButton('Material finish')).toBeUndefined();
});

it('exposes the real shared appearance palette and drives body color', async () => {
  await click('Material properties');
  const panel=container.querySelector('[data-panel="visualization"]');
  await act(async()=>{const target=panel.querySelector('[aria-label="Appearance target"]');target.value='defaults';target.dispatchEvent(new Event('change',{bubbles:true}));});
  const {cadAppearance}=await import('../cad-appearance-store');
  const original=cadAppearance.snapshot().bodyColor ?? '#79a9c2';
  await act(async()=>[...panel.querySelectorAll('button')].find(b=>b.textContent==='Appearance').click());
  const red=panel.querySelector('[aria-label="Use color #ff3045"]');
  expect(red).toBeTruthy();
  await act(async()=>red.click());
  expect(cadAppearance.snapshot().bodyColor).toBe('#ff3045');
  expect(panel.querySelector('[aria-label="Hex"]').value).toBe('#FF3045');
  expect(panel.textContent).toContain('255 · 48 · 69');
  expect(panel.querySelector('[aria-label="Appearance opacity"]')).toBeTruthy();
  expect(panel.querySelector('[aria-label="Tessellation"]')).toBeNull();
  await act(async()=>cadAppearance.dispatch({type:'set-body-color',color:original}));
});


it('presents real parts with shared tree controls and opens appearance from their context menu', async () => {
  const actions = [];
  const unregister = cadWorkspace.registerActionHandler(action => actions.push(action));
  await act(async () => cadWorkspace.publish({...cadWorkspace.snapshot(),
    bodyNodes: [{id:'bodies/test', label:'Bodies', children:[
      {id:'feature/body/plate',label:'Mounting plate',actions:[
        {id:'body-visibility',label:'Hide Mounting plate'}, {id:'body-rename',label:'Rename Mounting plate'}]},
      {id:'feature/body/pin',label:'Pivot pin',dimmed:true,actions:[
        {id:'body-visibility',label:'Show Pivot pin'}, {id:'body-rename',label:'Rename Pivot pin'}]},
    ]}], selectedItemIDs:new Set(['feature/body/plate']),
  }));
  const parts = container.querySelector('.cad-parts-panel');
  expect(parts.textContent).toContain('Parts (2)');
  expect(parts.querySelectorAll('.aui-listbox-description')).toHaveLength(0);
  expect(parts.querySelector('.cad-part-appearance-swatch')).toBeNull();
  expect(parts.querySelectorAll('[role=treeitem]')).toHaveLength(2);
  const visibility = parts.querySelector('[aria-label="Hide Mounting plate"]');
  expect(visibility).toBeTruthy();
  await act(async()=>visibility.click());
  expect(actions.at(-1)).toEqual({type:'item-action',id:'feature/body/plate',actionID:'body-visibility'});
  expect(actions.some(action=>action.type==='select-item')).toBe(false);
  const row = parts.querySelector('[role="treeitem"]');
  await act(async()=>row.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true})));
  expect(actions.at(-1)).toEqual({type:'item-action',id:'feature/body/plate',actionID:'body-rename'});
  const openAppearance = async () => {
    await act(async()=>row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:30,clientY:700})));
    const appearance=[...document.querySelectorAll('[role="menuitem"]')].find(item=>item.textContent.includes('appearance'));
    expect(appearance).toBeTruthy();await act(async()=>appearance.click());
  };
  await openAppearance();
  expect(isVisible(container.querySelector('[data-panel="visualization"]'))).toBe(true);
  await click('Material properties');
  expect(isVisible(container.querySelector('[data-panel="visualization"]'))).toBe(false);
  await openAppearance();
  expect(isVisible(container.querySelector('[data-panel="visualization"]'))).toBe(true);
  unregister();
});

it('adds pinnable support shortcuts and routes layout controls to real panels', async()=>{
  await act(async()=>container.querySelector('.aui-workspace-quick-controls [aria-label="Settings"]').click());
  const settings=document.querySelector('.aui-settings-window');
  expect(settings).toBeTruthy();
  await act(async()=>[...settings.querySelectorAll('button')].find(button=>button.textContent==='Header').click());
  for (const label of ['Workspace layout','Comments','Reminders']) {
    const checkbox=settings.querySelector(`[aria-label="Show ${label} in header"]`);
    expect(checkbox).toBeTruthy();
    if (!checkbox.checked) await act(async()=>checkbox.click());
  }
  await act(async()=>settings.querySelector('[aria-label^="Close "]').click());
  const header=container.querySelector('.aui-workspace-quick-controls');
  await act(async()=>header.querySelector('[aria-label="Comments"]').click());
  expect(isVisible(container.querySelector('section[aria-label="Comments"]'))).toBe(true);
  await act(async()=>header.querySelector('[aria-label="Comments"]').click());
  expect(isVisible(container.querySelector('section[aria-label="Comments"]'))).toBe(false);
  await act(async()=>header.querySelector('[aria-label="Comments"]').click());
  await act(async()=>header.querySelector('[aria-label="Reminders"]').click());
  expect(isVisible(container.querySelector('section[aria-label="Reminders"]'))).toBe(true);
  expect(isVisible(container.querySelector('section[aria-label="Comments"]'))).toBe(false);
  await act(async()=>header.querySelector('[aria-label="Workspace layout"]').click());
  const select=document.querySelector('[aria-label="Features and parts placement"]');
  expect(select).toBeTruthy();
  await act(async()=>{select.value='hidden';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(cadPresentation.snapshot().panelPlacements.browser).toBe('hidden');
  await act(async()=>document.querySelector('[aria-label="Close workspace layout"]').click());
});

it('formats inspector quantities in document units',async()=>{
  const {applyDocumentUnits,documentUnits}=await import('../document-preferences');
  const {cadSelection}=await import('../cad-selection-store');
  const original=documentUnits();
  const respond=()=>window.dispatchEvent(new window.CustomEvent('aether-plane-geometry',{detail:{points:[{label:'Center A',positionMillimeters:[0,0,0]},{label:'Center B',positionMillimeters:[25.4,0,0]}]}}));
  window.addEventListener('aether-plane-geometry-request',respond);
  try {
    await act(async()=>{
      applyDocumentUnits({length:{unit:'in',decimals:3}});
      cadWorkspace.publish({...cadWorkspace.snapshot(),inspectorSections:[{id:'parameters',label:'Dimensions',properties:[{id:'width',label:'Width',value:'25.4 mm',quantity:{si:.0254,family:'length'}}]}]});
      cadSelection.dispatch({type:'replace',items:[{id:'a',partId:'part',kind:'vertex',label:'A'},{id:'b',partId:'part',kind:'vertex',label:'B'}]});
    });
    await click('Inspect');
    const inspection=container.querySelector('[aria-label="Exact model inspection"]');
    expect(inspection.textContent).toContain('1.000 in');
    await act(async()=>applyDocumentUnits({length:{unit:'mm',decimals:2}}));
    expect(inspection.textContent).toContain('25.40 mm');
  } finally {
    window.removeEventListener('aether-plane-geometry-request',respond);
    await act(async()=>{applyDocumentUnits(original);cadSelection.dispatch({type:'clear'});});
  }
});

it('switches the camera projection through the viewer action and disables perspective-only FOV',async()=>{
  const {cadCameraPresentation}=await import('../cad-camera-presentation-store');
  const actions=[];
  const release=cadCameraPresentation.registerActionHandler(action=>{
    actions.push(action);
    if(action.type==='set-projection')cadCameraPresentation.setProjection(action.projection);
  });
  try {
    await click('Camera and display');
    const projection=container.querySelector('[aria-label="Camera projection"]');
    const fov=container.querySelector('[aria-label="Camera field of view"]');
    expect(projection.disabled).toBe(false);
    await act(async()=>{projection.value='orthographic';projection.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(actions.at(-1)).toEqual({type:'set-projection',projection:'orthographic'});
    expect(fov.disabled).toBe(true);
    await act(async()=>{projection.value='perspective';projection.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(fov.disabled).toBe(false);
  } finally {release();await act(async()=>cadCameraPresentation.setProjection('perspective'));}
});

it('opens related rendering tools repeatedly without leaving the assembly workspace',async()=>{
 const {requestCADPropertyPanel}=await import('../cad-presentation-store');
 await act(async()=>cadPresentation.patch({workspaceMode:'assembly'}));
 await act(async()=>requestCADPropertyPanel('rendering'));
 expect(isVisible(container.querySelector('[data-panel="rendering"]'))).toBe(true);
 await click('Rendering environment');expect(isVisible(container.querySelector('[data-panel="rendering"]'))).toBe(false);
 await act(async()=>requestCADPropertyPanel('rendering'));
 expect(isVisible(container.querySelector('[data-panel="rendering"]'))).toBe(true);
 expect(cadPresentation.snapshot().workspaceMode).toBe('assembly');
});
