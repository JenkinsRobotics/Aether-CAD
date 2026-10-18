// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {CADPrimitiveDialog} from './CADPrimitiveDialog';
import {configureCADImport} from '../modeling/cad-import-service';
let root,container,doc,commit,evaluate,onClose;
beforeEach(async()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);doc=null;commit=vi.fn(next=>{doc=next});evaluate=vi.fn(async()=>({parts:[]}));onClose=vi.fn();configureCADImport({current:()=>doc,available:()=>true,evaluate,commit});container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root.render(<CADPrimitiveDialog kind="box" onClose={onClose}/>));});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
async function click(label){await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent===label).click());}
it('builds a native candidate before committing the two history features',async()=>{await click('Create');expect(evaluate).toHaveBeenCalledOnce();expect(commit).toHaveBeenCalledOnce();expect(doc.features.map(f=>f.type)).toEqual(['profile','extrude']);expect(onClose).toHaveBeenCalledOnce();});
it('converts displayed dimensions on a unit change without altering the geometry',async()=>{const units=document.querySelector('#primitive-units');await act(async()=>{units.value='25.4';units.dispatchEvent(new Event('change',{bubbles:true}));});await click('Create');expect(doc.features[1].distanceMillimeters).toBeCloseTo(10);expect(doc.features[0].profile.pointsMillimeters[0]).toEqual([-10,-15]);});
it('cancellation prevents a pending native build from committing',async()=>{let resolve;evaluate.mockImplementation(()=>new Promise(r=>resolve=r));await click('Create');await click('Cancel');await act(async()=>resolve({parts:[]}));expect(commit).not.toHaveBeenCalled();});
it('reports native failure without changing the source document',async()=>{evaluate.mockRejectedValue(new Error('Invalid solid'));await click('Create');expect(commit).not.toHaveBeenCalled();expect(document.querySelector('[role=alert]').textContent).toBe('Invalid solid');});
