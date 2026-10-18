import {createRequire} from 'node:module';
import React,{act} from 'react';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect,vi} from 'vitest';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
let dom,root,container,Panel,objects,selection,appearance,presets,detach,values,requestPanel;
beforeAll(async()=>{
 dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/',pretendToBeVisual:true});
 for(const key of ['window','document','navigator','HTMLElement','Element','Node','HTMLInputElement','Event','MouseEvent','KeyboardEvent','localStorage','location','crypto'])vi.stubGlobal(key,dom.window[key]);
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 Panel=(await import('./part-appearance')).PartAppearancePanel;
 objects=(await import('../../cad-object-appearance')).cadObjectAppearance;
 selection=(await import('../../cad-selection-store')).cadSelection;
 appearance=(await import('../../cad-appearance-store')).cadAppearance;
 presets=(await import('../../cad-render-materials')).cadMaterialPresets;
 requestPanel=(await import('../../cad-presentation-store')).requestCADPropertyPanel;
});
beforeEach(async()=>{
 appearance.dispatch({type:'reset'});for(const p of presets.snapshot())presets.remove(p.id);
 values={a:{color:'#112233',edgeWidthPx:3},b:{color:'#224466'}};
 detach=objects.attach({getPartRows:()=>[{id:'a',name:'Plate',sourceDocumentId:'doc'},{id:'b',name:'Pin',sourceDocumentId:'doc'}],getPartDisplay:id=>values[id],setPartDisplay:(id,v)=>{values[id]=v;}});
 selection.dispatch({type:'replace',items:[{id:'a',partId:'a',kind:'body',label:'Plate'}]});
 container=document.createElement('div');document.body.append(container);root=(await import('react-dom/client')).createRoot(container);await act(async()=>root.render(<Panel/>));
});
afterEach(async()=>{await act(async()=>{root.unmount();detach();selection.dispatch({type:'clear'});});container.remove();});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});
const click=text=>act(async()=>[...container.querySelectorAll('button,summary')].find(e=>e.textContent===text).click());
const select=(label,value)=>act(async()=>{const e=container.querySelector(`select[aria-label="${label}"]`);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));});
const type=(label,value)=>act(async()=>{const e=container.querySelector(`input[aria-label="${label}"]`);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,String(value));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));});
it('assigns a material only to the selected part, keeps edge styling, and synchronizes gloss with roughness',async()=>{
 await select('Render material','brass');expect(values.a).toMatchObject({color:'#c7a65b',metalness:.85,roughness:.24,edgeWidthPx:3});expect(values.b).toEqual({color:'#224466'});expect(appearance.snapshot().metalness).toBeUndefined();
 await type('Object gloss',90);expect(values.a.roughness).toBeCloseTo(.1);expect(container.querySelector('[aria-label="Object roughness"]').value).toBe('10');
 await select('Object finish','matte');expect(values.a.roughness).toBe(.8);expect(values.a.metalness).toBe(.85);
 await type('Emission color picker','#aa2200');await type('Emission strength',2);expect(values.a).toMatchObject({emissiveColor:'#aa2200',emissiveIntensity:2});
});
it('searches the shared material browser and applies its card to the target',async()=>{
 expect([...container.querySelector('[aria-label="Material properties tabs"]').querySelectorAll('button')].map(e=>e.textContent)).toEqual(['Material','Appearance']);
 expect(container.querySelector('[aria-label="Visualization"]')).toBeNull();
 await type('Search materials','copper');const cards=[...container.querySelectorAll('.aui-material-browser__item')];expect(cards).toHaveLength(2);
 expect(cards.some(card=>card.textContent.includes('Studio finish'))).toBe(true);
 await act(async()=>cards.find(card=>card.textContent.includes('Satin')).click());expect(values.a.color).toBe('#b87550');expect(container.querySelector('[aria-label="Appearance inspector"]')).toBeTruthy();
 await click('Model edges');await type('Object edge thickness',4);expect(values.a.edgeWidthPx).toBe(4);
 await click('Material');expect(container.querySelector('[aria-label="Search materials"]')).toBeTruthy();expect(values.a.color).toBe('#b87550');
});
it('an explicit part property request returns to the selected part instead of a previously named target',async()=>{
 await select('Appearance target',JSON.stringify(['doc','b']));
 await act(async()=>requestPanel('visualization'));
 expect(container.querySelector('[aria-label="Appearance target"]').value).toBe('selection');
 await select('Render material','copper');expect(values.a.color).toBe('#b87550');expect(values.b).toEqual({color:'#224466'});
});
it('saves modified material values, reuses them on another object, and removes only the library recipe',async()=>{
 await select('Render material','aluminum');await type('Object roughness',35);await type('Custom material name','Workshop aluminum');await click('Save material');
 const saved=presets.snapshot()[0];expect(saved.values.roughness).toBe(.35);
 await select('Appearance target',JSON.stringify(['doc','b']));await select('Render material',saved.id);expect(values.b.roughness).toBe(.35);expect(values.b.color).toBe('#b8c2ca');
 await click('Remove saved material');expect(presets.snapshot()).toEqual([]);expect(values.b.roughness).toBe(.35);
});
it('multiselect changes only the edited property, reset restores defaults, and no selection cannot edit',async()=>{
 await act(async()=>selection.dispatch({type:'replace',items:[{id:'a',partId:'a',kind:'body',label:'Plate'},{id:'b',partId:'b',kind:'body',label:'Pin'}]}));
 expect(container.textContent).toContain('Mixed materials');await click('Appearance');await type('Appearance opacity',45);
 expect(values.a).toEqual({color:'#112233',edgeWidthPx:3,opacity:.45});expect(values.b).toEqual({color:'#224466',opacity:.45});
 await click('Use environment defaults');expect(values).toEqual({a:{},b:{}});
 await act(async()=>selection.dispatch({type:'clear'}));expect(container.querySelector('fieldset').disabled).toBe(true);
});
