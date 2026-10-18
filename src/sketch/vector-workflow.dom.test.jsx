import { createRequire } from 'node:module';
import {beforeAll,afterAll,expect,it,vi} from 'vitest';
import {createEmptyPartDocument,parsePartDocument,serializePartDocument} from '@aether/core/document';
import {clickSketchControl} from './test-controls';
import {cadCommands} from '../cad-command-registry';
const require=createRequire(import.meta.url),{JSDOM}=require('jsdom');let dom,open;
beforeAll(async()=>{dom=new JSDOM('<div class="cad-studio-viewport"></div>',{url:'http://localhost/cad/'});for(const key of ['window','document','HTMLElement','CustomEvent','Event','DOMParser','location'])vi.stubGlobal(key,dom.window[key]);open=(await import('../sketch-workspace')).openSketchWorkspace;});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});
it('opens Vector tools through the command, imports holes/cubics with units, undoes and reopens',async()=>{
 let doc=createEmptyPartDocument('SVG vectors');const apply=vi.fn(async next=>{doc=next;});open(()=>doc,apply);clickSketchControl('Top (XY)');cadCommands.execute('sketch-vector');
 const file=document.querySelector('[aria-label="CAD SVG file"]');expect(file).toBeTruthy();
 const units=document.querySelector('[aria-label="Millimeters per SVG unit"]');units.value='1';units.dispatchEvent(new Event('change'));
 Object.defineProperty(file,'files',{value:[{text:async()=>'<svg xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M0 0h100v100h-100z M25 25h50v50h-50z"/><path d="M150 0 C160 20 170 20 180 0"/></svg>'}],configurable:true});file.dispatchEvent(new Event('change'));
 const insert=()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Insert SVG contours');await vi.waitFor(()=>expect(insert().disabled).toBe(false));insert().click();expect(document.querySelectorAll('.sketch-contour')).toHaveLength(3);
 clickSketchControl('Undo');expect(document.querySelectorAll('.sketch-contour')).toHaveLength(0);clickSketchControl('Redo');clickSketchControl('Finish sketch');await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 doc=parsePartDocument(serializePartDocument(doc));const contours=doc.features[0].profile.contours;expect(contours.map(c=>c.hole)).toEqual([false,true,false]);expect(contours[2].segments[0]).toEqual({type:'bezier',end:[180,0],controls:[[160,-20],[170,-20]]});
 open(()=>doc,apply,doc.features[0]);expect(document.querySelectorAll('.sketch-contour')).toHaveLength(3);clickSketchControl('Cancel');
});
