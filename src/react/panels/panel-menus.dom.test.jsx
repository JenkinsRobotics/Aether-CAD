// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(), assemblyDispatch: vi.fn(), execute: vi.fn(), panelCommand: vi.fn(),
  workspace: null, assembly: null, presentation: null,
  commands: new Proxy({}, {get: () => ({enabled:true,active:false})}),
}));
vi.mock('../../cad-workspace-store', () => ({cadWorkspace:{
  subscribe: () => () => {}, snapshot: () => mocks.workspace, dispatch: mocks.dispatch,
}}));
vi.mock('../../cad-assembly-workspace-store', () => ({cadAssemblyWorkspace:{
  subscribe: () => () => {}, snapshot: () => mocks.assembly, dispatch: mocks.assemblyDispatch,
}}));
vi.mock('../../cad-presentation-store', () => ({cadPresentation:{
  subscribe: () => () => {}, snapshot: () => mocks.presentation, dispatch: vi.fn(),
}}));
vi.mock('../../cad-command-registry', () => ({cadCommands:{
  subscribe: () => () => {}, snapshot: () => mocks.commands, execute: mocks.execute,
}}));
vi.mock('./panel-context-commands', () => ({useCADPanelContext: () => ({
  items:[{id:'create',label:'New sketch…'}, {id:'show',label:'Show all parts'}], run: mocks.panelCommand,
})}));
vi.mock('../../viewport/context-menu', () => ({cadViewportContext:{zoomTo:vi.fn(),isolate:vi.fn()}}));
import { CADHistoryPanel } from './history';
import { ItemsPanel } from './items';
import { CADPartsPanel, CADAssemblyPartsPanel } from './parts';

let container, root;
const body = {id:'feature/body/b',label:'Body 1',actions:[
  {id:'body-rename',label:'Rename',icon:'r'}, {id:'body-visibility',label:'Hide body',icon:'v'},
]};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.presentation = {partOpen:true,workspaceMode:'modeling',backendState:'ready',itemFilterFocusSerial:0};
  mocks.workspace = {itemNodes:[{id:'feature/extrude/f',label:'Extrude 1',actions:[
    {id:'rename-feature',label:'Rename',icon:'r'}, {id:'edit-feature',label:'Edit',icon:'e'},
    {id:'suppress-feature',label:'Suppress',icon:'s'},
  ]}],bodyNodes:[],selectedItemIDs:new Set(['feature/extrude/f']),expandedItemIDs:new Set(),
    rollbackIndex:1,historyItems:[{id:'history/feature/f'}]};
  mocks.workspace.historyNodes = [...mocks.workspace.itemNodes];
  mocks.assembly = {loadState:'ready',selectedEntityIDs:new Set(['component-1']),
    data:{instanceRows:[{id:'component-1',label:'Bracket'}]}};
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.clearAllMocks(); vi.unstubAllGlobals();
});
const event = async (element, type, options={}) => act(async () => element.dispatchEvent(
  type === 'keydown' ? new KeyboardEvent(type,{bubbles:true,cancelable:true,...options})
    : new MouseEvent(type,{bubbles:true,cancelable:true,...options}),
));
const button = label => [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label);
const menuLabels = () => [...document.querySelectorAll('[role="menuitem"] .aui-menu-label')].map(el=>el.textContent);
const menuAction = async label => {
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(item=>item.querySelector('.aui-menu-label')?.textContent === label);
  expect(item).toBeTruthy(); await event(item,'click');
};
const verifyMenus = async (rowName, backgroundSelector) => {
  const row = [...container.querySelectorAll('[role="treeitem"]')].find(row=>row.textContent.includes(rowName));
  await event(row,'contextmenu'); const labels = menuLabels();
  expect(labels.length).toBeGreaterThan(0);
  expect(labels.join('|')).not.toMatch(/Undo|Redo|Aether CAD settings/);
  await event(document,'keydown',{key:'Escape'});
  await event(button(`Options for ${rowName}`),'click'); expect(menuLabels()).toEqual(labels);
  await event(document,'keydown',{key:'Escape'});
  await event(container.querySelector(backgroundSelector),'contextmenu');
  expect(menuLabels()).toContain('New sketch…');
  expect(menuLabels().join('|')).not.toMatch(/Undo|Redo|settings|Rename/);
  await menuAction('New sketch…'); expect(mocks.panelCommand).toHaveBeenCalledWith('create');
  return row;
};
it('Features exposes matching row menus, background creation and safe row shortcuts', async () => {
  await act(async()=>root.render(<ItemsPanel active/>));
  expect(container.querySelector('.aui-collection-footer')).toBeNull();
  const headers = [...container.querySelectorAll('.aui-collection-heading')];
  expect(headers).toHaveLength(2);
  for (const header of headers) {
    const buttons = [...header.querySelectorAll('button')];
    expect(buttons).toHaveLength(2);
    expect(buttons[0].getAttribute('aria-label')).toMatch(/^Create in/);
    expect(buttons[1].getAttribute('aria-label')).toMatch(/options$/);
  }
  await event(headers[0].querySelector('button'),'click');
  await menuAction('New folder');
  expect(mocks.dispatch).toHaveBeenLastCalledWith({type:'create-folder',memberIDs:['feature/extrude/f']});
  const row = await verifyMenus('Extrude 1','.cad-items-tree .aui-tree-panel-content');
  await event(row,'keydown',{key:'F2'});
  expect(mocks.dispatch).toHaveBeenLastCalledWith({type:'item-action',id:'feature/extrude/f',actionID:'rename-feature'});
  await event(row,'keydown',{key:'Backspace'});
  expect(mocks.dispatch).toHaveBeenLastCalledWith({type:'item-action',id:'feature/extrude/f',actionID:'delete-feature'});
  const before = mocks.dispatch.mock.calls.length;
  const search = container.querySelector('input[type="search"]');
  const native = new MouseEvent('contextmenu',{bubbles:true,cancelable:true});
  await act(async()=>search.dispatchEvent(native)); expect(native.defaultPrevented).toBe(false);
  await event(search,'keydown',{key:'Delete'}); expect(mocks.dispatch).toHaveBeenCalledTimes(before);
  expect(document.querySelector('[role="menu"]')).toBeNull();
});
it('Parts shares visibility/rename actions between its row menu and keyboard', async () => {
  await act(async()=>root.render(<CADPartsPanel nodes={[body]} selectedIDs={new Set([body.id])}
    onSelect={()=>{}} onAction={mocks.dispatch} onShowAppearance={()=>{}}/>));
  expect(container.querySelector('.aui-collection-footer')).toBeNull();
  expect(container.querySelectorAll('.aui-collection-heading button')).toHaveLength(2);
  const row = await verifyMenus('Body 1','.aui-tree-panel-content');
  await event(row,'contextmenu'); await menuAction('Hide');
  expect(mocks.dispatch).toHaveBeenLastCalledWith(body.id,'body-visibility');
  await event(row,'keydown',{key:'F2'});
  expect(mocks.dispatch).toHaveBeenLastCalledWith(body.id,'body-rename');
});
it('Components shares its menu with ellipsis and uses the existing edit/remove commands', async () => {
  await act(async()=>root.render(<CADAssemblyPartsPanel/>));
  const row = await verifyMenus('Bracket','.aui-tree-panel-content');
  await event(row,'keydown',{key:'F2'});
  expect(mocks.execute).toHaveBeenLastCalledWith('assembly-edit-component');
  await event(row,'keydown',{key:'Delete'});
  expect(mocks.execute).toHaveBeenLastCalledWith('assembly-remove-instance');
  expect(mocks.assemblyDispatch).toHaveBeenCalledWith({type:'select-entities',ids:['component-1'],mode:'single'});
});

it('History expands without editing and uses the feature commands for row menus and F2', async () => {
  mocks.workspace.historyItems = [{id:'history/feature/f',label:'Extrude 1',description:'Solid feature',group:'Part history'}];
  await act(async()=>root.render(<CADHistoryPanel/>));
  const step = [...container.querySelectorAll('button')].find(button=>button.textContent === 'Extrude 1');
  await event(step,'click'); expect(step.getAttribute('aria-expanded')).toBe('true');
  expect(mocks.dispatch).not.toHaveBeenCalled();
  await event(step,'click'); expect(step.getAttribute('aria-expanded')).toBe('false');
  await event(step,'contextmenu'); const labels = menuLabels();
  expect(labels).toContain('Rename'); expect(labels).toContain('Edit…');
  await event(document,'keydown',{key:'Escape'});
  await event(button('Actions for Extrude 1'),'click'); expect(menuLabels()).toEqual(labels);
  await event(document,'keydown',{key:'Escape'});
  await event(step,'keydown',{key:'F2'});
  expect(mocks.dispatch).toHaveBeenLastCalledWith({type:'item-action',id:'feature/extrude/f',actionID:'rename-feature'});
});

it('placement actions stay out of Features but remain editable and suppressible in History', async () => {
  const move={id:'feature/transform/move',label:'Move parts',actions:[
    {id:'edit-feature',label:'Edit Move parts'}, {id:'suppress-feature',label:'Suppress Move parts'},
  ]};
  mocks.workspace.historyNodes.push(move);
  mocks.workspace.historyItems=[{id:'history/feature/f',label:'Extrude 1'}, {id:'history/feature/move',label:'Move parts',description:'Placement action'}];
  mocks.workspace.rollbackIndex=2;
  await act(async()=>root.render(<><ItemsPanel active/><CADHistoryPanel/></>));
  expect(container.querySelector('[aria-label="CAD features"]').textContent).not.toContain('Move parts');
  expect(container.textContent).toContain('Features (1)');
  await event(button('Actions for Move parts'),'click');
  expect(menuLabels()).toContain('Edit…');
  expect(menuLabels()).not.toContain('Show imported parts');
  await menuAction('Suppress');
  expect(mocks.dispatch).toHaveBeenLastCalledWith({type:'item-action',id:move.id,actionID:'suppress-feature'});
  await event(button('Actions for Move parts'),'click');
  await menuAction('Edit…');
  expect(mocks.dispatch).toHaveBeenLastCalledWith({type:'item-action',id:move.id,actionID:'edit-feature'});
});
