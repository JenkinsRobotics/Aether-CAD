import {createRequire} from 'node:module';
import {act} from 'react';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {CADTraditionalRibbon} from './CADTraditionalRibbon';

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
const button=(label:string)=>{
  const element=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(item=>item.getAttribute('aria-label')===label);
  if(!element)throw Error(`Missing button: ${label}; available: ${Array.from(document.querySelectorAll('button')).map(item=>item.getAttribute('aria-label')).join(', ')}`);
  return element;
};
const click=async(element:HTMLElement)=>act(async()=>element.click());

it('opens the six-domain tray, executes Canvas and refuses unavailable construction tools',async()=>{
  const {createRoot}=await import('react-dom/client'),host=document.createElement('div');
  document.body.append(host);const root=createRoot(host),action=vi.fn();
  try {
    await act(async()=>root.render(<CADTraditionalRibbon documentType="part" activeWorkspace="solid" partOpen onSelectWorkspace={vi.fn()} onAction={action}/>));
    await click(button('Features'));
    for(const domain of ['Part','Assembly','Sketch','Curve','Solid','Drawing'])expect(button(`${domain} tools`)).toBeTruthy();
    await click(button('Part tools'));
    await click(document.querySelector<HTMLElement>('[data-menu-item-id="feature-group:home-insert"]')!);
    const canvas=Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).find(item=>item.textContent?.trim()==='Canvas');
    expect(canvas).toBeTruthy();await click(canvas!);
    expect(action).toHaveBeenLastCalledWith('insert-canvas');
    await click(button('Solid tools'));
    await click(document.querySelector<HTMLElement>('[data-menu-item-id="feature-group:solid-create"]')!);
    const create=Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).map(item=>item.textContent?.trim());
    expect(create).toContain('Extrude');expect(create).not.toContain('Cone'); // No premade shapes.
    await click(Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).find(item=>item.textContent?.trim()==='Extrude')!); // Closes the menu; Extrude is disabled here.
    await click(button('Part tools'));
    await click(document.querySelector<HTMLElement>('[data-menu-item-id="feature-group:part-construction-gaps"]')!);
    const axis=Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).find(item=>item.textContent?.includes('Work axis'));
    expect((axis as HTMLButtonElement)?.disabled).toBe(true);
    await click(axis!);expect(action).toHaveBeenCalledTimes(1);
  } finally {await act(async()=>root.unmount());host.remove();}
});

it('opens the feature tray from the docked toolbar',async()=>{
  const {createRoot}=await import('react-dom/client'),host=document.createElement('div');
  document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>root.render(<CADTraditionalRibbon placement="docked" documentType="part" activeWorkspace="solid" partOpen onSelectWorkspace={vi.fn()} onAction={vi.fn()}/>));
    await click(button('Features'));
    expect(document.querySelector('[data-ribbon-workspace="feature-library"]')).toBeTruthy();
    expect(button('Solid tools')).toBeTruthy();
  } finally {await act(async()=>root.unmount());host.remove();}
});
