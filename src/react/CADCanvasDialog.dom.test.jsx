// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {CADCanvasDialog} from './CADCanvasDialog';
import {configureCADImport} from '../modeling/cad-import-service';
import {createEmptyPartDocument} from '@aether/core/document';
let root,container,doc,commit,onClose;
beforeEach(async()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);doc={...createEmptyPartDocument('Part'),imageCanvases:[{id:'image',name:'Reference',dataUrl:'data:image/png;base64,YQ==',plane:'XY',widthMillimeters:100,heightMillimeters:50,xMillimeters:1,yMillimeters:2,offsetMillimeters:3,rotationDegrees:45,opacity:.5,visible:true}]};commit=vi.fn(next=>{doc=next;});onClose=vi.fn();configureCADImport({current:()=>doc,available:()=>true,evaluate:vi.fn(()=>{throw Error('Images must not rebuild geometry');}),commit:vi.fn(),commitPresentation:commit});container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root.render(<CADCanvasDialog open onClose={onClose}/>));});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
async function chooseSaved(){const select=document.querySelector('select');await act(async()=>{select.value='image';select.dispatchEvent(new Event('change',{bubbles:true}));});}
async function click(label){await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent===label).click());}
it('edits an existing embedded image and commits without a kernel call',async()=>{await chooseSaved();const visible=document.querySelector('input[type=checkbox]');await act(async()=>visible.click());await click('Save');expect(commit).toHaveBeenCalledOnce();expect(doc.imageCanvases[0]).toMatchObject({id:'image',visible:false,rotationDegrees:45});expect(onClose).toHaveBeenCalledOnce();});
it('removes the saved image and preserves the Part',async()=>{await chooseSaved();await click('Remove');expect(doc.imageCanvases).toEqual([]);expect(doc.name).toBe('Part');});
it('cancel leaves the document untouched',async()=>{await chooseSaved();await click('Cancel');expect(commit).not.toHaveBeenCalled();});
it('refuses a stale editor after another document update',async()=>{await chooseSaved();doc={...doc,name:'Changed externally'};await click('Save');expect(commit).not.toHaveBeenCalled();expect(document.querySelector('[role=alert]').textContent).toContain('Part changed');});
