import {createRequire} from 'node:module';
import {act} from 'react';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {CADTraditionalRibbon} from './CADTraditionalRibbon';
import {cadFeaturePalette} from './cad-feature-tray';

let dom:any;
beforeAll(()=>{
  const {JSDOM}=createRequire(import.meta.url)('jsdom');
  dom=new JSDOM('<body></body>',{url:'http://localhost'});
  for(const key of ['window','document','HTMLElement','Element','Node','navigator','Event','KeyboardEvent','MouseEvent','localStorage'])vi.stubGlobal(key,dom.window[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('requestAnimationFrame',(callback:()=>void)=>setTimeout(callback,0));
  vi.stubGlobal('cancelAnimationFrame',clearTimeout);
});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});

it('has no catch-all Features tab: a tool is listed once, on its own tab, and search still reaches every feature',async()=>{
  const {createRoot}=await import('react-dom/client'),host=document.createElement('div');
  document.body.append(host);const root=createRoot(host);
  try {
    for(const placement of ['floating','docked'] as const){
      await act(async()=>root.render(<CADTraditionalRibbon placement={placement} documentType="part" activeWorkspace="solid" partOpen onSelectWorkspace={vi.fn()} onAction={vi.fn()}/>));
      expect(Array.from(document.querySelectorAll('button')).some(item=>item.getAttribute('aria-label')==='Features')).toBe(false);
      expect(document.querySelector('[data-ribbon-workspace="feature-library"]')).toBeNull();
    }
  } finally {await act(async()=>root.unmount());host.remove();}
  const commands=cadFeaturePalette({commands:{} as never,partOpen:true,assemblyReady:false},[]);
  const ids=commands.map(command=>command.id);
  expect(ids).toContain('insert-canvas');
  expect(ids).toContain('feature-extrude');
  expect(commands.map(command=>command.label)).not.toContain('Cone'); // No premade shapes.
  expect(new Set(ids).size).toBe(ids.length); // one entry per action
});
