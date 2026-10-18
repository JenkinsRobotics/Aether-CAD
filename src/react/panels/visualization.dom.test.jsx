import { createRequire } from 'node:module';
import React, { act } from 'react';
import { beforeAll, beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom, root, container, Panel, appearance, presets;
beforeAll(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {url:'http://localhost/',pretendToBeVisual:true});
  for (const key of ['window','document','navigator','HTMLElement','Element','Node','HTMLInputElement','Event','MouseEvent','KeyboardEvent','localStorage','location','crypto']) vi.stubGlobal(key,dom.window[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  Panel = (await import('./visualization')).VisualizationPanel;
  appearance = (await import('../../cad-appearance-store')).cadAppearance;
  presets = (await import('../../cad-environment-presets')).cadEnvironmentPresets;
});
beforeEach(async () => {
  appearance.dispatch({type:'reset'});
  for (const item of presets.snapshot()) presets.remove(item.id);
  container=document.createElement('div');document.body.append(container);
  root=(await import('react-dom/client')).createRoot(container);
  await act(async()=>root.render(<Panel active/>));
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});
const button = text => [...container.querySelectorAll('button,summary')].find(e=>e.textContent===text);
const click = text => act(async()=>button(text).click());
const type = (label,value) => act(async()=>{
  const input=container.querySelector(`input[aria-label="${label}"]`);
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,String(value));
  input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
});
const select = (label,value) => act(async()=>{
  const input=container.querySelector(`select[aria-label="${label}"]`);input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));
});

it('offers live advanced controls with actual opacity and rejects invalid spacing',async()=>{
  await select('Environment preset','cad-light'); await click('Advanced');
  await type('Grid spacing',12);await type('Minor line opacity',100);await type('Plane border thickness',4);
  expect(appearance.snapshot()).toMatchObject({gridSpacingMillimeters:12,gridMinorOpacityPercent:100,planeBorderWidthPx:4});
  await type('Grid spacing',0);
  expect(appearance.snapshot().gridSpacingMillimeters).toBe(12);
  expect(container.querySelector('[aria-label="Grid spacing"]').getAttribute('aria-invalid')).toBe('true');
  await select('Background style','gradient'); expect(container.querySelector('[aria-label="Bottom color"]')).toBeTruthy();
  await type('Bottom color picker','#112233'); expect(appearance.snapshot().backgroundBottomColor).toBe('#112233');
});

it('saves, modifies, restores, updates and recalls a named preset through the panel',async()=>{
  await click('Advanced');await type('Grid spacing',18);await type('Custom preset name','Workshop');await click('Save as new preset');
  const saved=presets.snapshot()[0];expect(saved.name).toBe('Workshop');
  expect(container.querySelector('[role="status"]').textContent).toContain('Saved “Workshop”');
  await type('Grid spacing',30);
  expect(container.querySelector('[aria-label="Environment preset"]').selectedOptions[0].textContent).toContain('Modified');
  await click('Restore saved preset');expect(appearance.snapshot().gridSpacingMillimeters).toBe(18);
  await type('Grid spacing',45);await click('Update saved preset');
  await select('Environment preset','midnight');await select('Environment preset',`saved:${saved.id}`);
  expect(appearance.snapshot().gridSpacingMillimeters).toBe(45);
  await click('Delete preset');expect(presets.snapshot()).toEqual([]);expect(appearance.snapshot().gridSpacingMillimeters).toBe(45);
});

it('offers familiar style presets, independent axes and light direction without object controls in Advanced',async()=>{
  await select('Environment preset','fusion360');
  expect(appearance.snapshot()).toMatchObject({bodyColor:'#898780',backgroundColor:'#ffffff'});
  await click('Advanced'); await type('X axis color picker','#aa0000'); await type('Y axis color picker','#00aa00');
  await type('Key light azimuth',30); await type('Key light elevation',20);
  expect(appearance.snapshot()).toMatchObject({gridXAxisColor:'#aa0000',gridYAxisColor:'#00aa00',keyLightAzimuthDegrees:30,keyLightElevationDegrees:20});
  expect(container.querySelector('[aria-label="Object roughness"]')).toBeNull();
  await click('Defaults');await click('Appearance'); await type('Object roughness',15);await click('Model edges'); await type('Object edge thickness',3);
  expect(appearance.snapshot()).toMatchObject({roughness:.15,edgeWidthPx:3});
  await select('Environment preset','blender');
  expect(appearance.snapshot()).toMatchObject({bodyColor:'#b0b0b0',backgroundColor:'#393939',roughness:.8});
});

it('edits only selected objects, preserves untouched properties and resets their overrides',async()=>{
  const {cadObjectAppearance:objects}=await import('../../cad-object-appearance');
  const {cadSelection}=await import('../../cad-selection-store');
  const values={a:{color:'#aa0000'},b:{color:'#00aa00'}};
  const viewer={getPartRows:()=>[{id:'a',name:'Plate',sourceDocumentId:'doc'},{id:'b',name:'Pin',sourceDocumentId:'doc'}],getPartDisplay:id=>values[id],setPartDisplay:(id,value)=>{values[id]=value;}};
  let detach;
  await act(async()=>{detach=objects.attach(viewer);cadSelection.dispatch({type:'replace',items:[{id:'a',partId:'a',kind:'body',label:'Plate'}]});});
  try {
    await click('Defaults'); await select('Appearance target','selection');
    await click('Appearance');await type('Object roughness',23);await click('Model edges'); await type('Object edge thickness',3.5);
    expect(values.a).toEqual({color:'#aa0000',roughness:.23,edgeWidthPx:3.5}); expect(values.b).toEqual({color:'#00aa00'});
    expect(appearance.snapshot().roughness).toBeUndefined();
    await act(async()=>cadSelection.dispatch({type:'replace',items:[{id:'a',partId:'a',kind:'body',label:'Plate'},{id:'b',partId:'b',kind:'body',label:'Pin'}]}));
    await click('Appearance');await type('Appearance opacity',70);
    expect(values.a.opacity).toBe(.7);expect(values.b).toEqual({color:'#00aa00',opacity:.7});
    await click('Use environment defaults'); expect(values).toEqual({a:{},b:{}});
    await act(async()=>cadSelection.dispatch({type:'clear'}));
    expect(container.querySelector('fieldset').disabled).toBe(true);
    expect(container.textContent).toContain('Select an object in the viewport');
  } finally { await act(async()=>{detach();cadSelection.dispatch({type:'clear'});}); }
});

it('changes render resolution and preserves it in a custom environment',async()=>{
 await type('Reflection intensity',75);await type('Reflection rotation',30);
 await type('Render resolution',150);expect(appearance.snapshot().renderScale).toBe(1.5);
 await type('Custom preset name','Sharp');await click('Save as new preset');
 const saved=presets.snapshot()[0];expect(saved.appearance.renderScale).toBe(1.5);expect(saved.appearance.reflectionIntensityPercent).toBe(75);expect(saved.appearance.reflectionRotationDegrees).toBe(30);
 await select('Environment preset','blender');await select('Environment preset',`saved:${saved.id}`);
 expect(appearance.snapshot().renderScale).toBe(1.5);
});

it('selects Model Studio, saves a variant and applies its finishes through real CAD controls',async()=>{
 await select('Environment preset','model-studio');
 expect(appearance.snapshot()).toMatchObject({environmentTheme:'model-studio',lightingPreset:'model-studio',backgroundColor:'#101112',exposure:1.15});
 await type('Custom preset name','Model Studio copy');await click('Save as new preset');
 const saved=presets.snapshot()[0];expect(saved.appearance.lightingPreset).toBe('model-studio');
 await select('Environment preset','onshape');await select('Environment preset',`saved:${saved.id}`);
 expect(appearance.snapshot().exposure).toBe(1.15);
 await click('Defaults');await select('Render material','model-studio-sage');
 expect(appearance.snapshot()).toMatchObject({bodyColor:'#98b4a2',roughness:.29,metalness:.62});
});
