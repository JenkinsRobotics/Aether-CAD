import { createRequire } from "node:module";
import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import { createRectanglePartDocument } from "@aether/core/document";
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
let dom, openPartAnalysis;
beforeAll(async () => {
  dom = new JSDOM('<body></body>', { url: 'http://localhost/cad/' });
  for (const key of ['window','document','HTMLElement','CustomEvent','Event','Option']) vi.stubGlobal(key, dom.window[key]);
  openPartAnalysis = (await import('./part-analysis')).openPartAnalysis;
});
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });
beforeEach(() => { document.body.innerHTML = '<div class="cad-studio-viewport"></div>'; });
it('ignores a pending result after Close and restores the full model', async () => {
  let reply;
  vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { reply = resolve; })));
  const show = vi.fn();
  openPartAnalysis('section', createRectanglePartDocument('Box', { widthMillimeters:10, heightMillimeters:10, depthMillimeters:10 }), show);
  await vi.waitFor(()=>expect(reply).toBeTypeOf('function'));
  document.querySelector('[aria-label="Close"]').click();
  reply({ ok:true, json:async()=>({status:'ok',bodies:[],measurements:[]}) });
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(show.mock.calls.every(([model])=>model===null)).toBe(true);
  expect(document.querySelector('.cad-analysis-dialog')).toBeNull();
});
it('shows a native failure without replacing the saved model', async () => {
  vi.stubGlobal('fetch', vi.fn(async()=>({ ok:true,json:async()=>({status:'error',message:'Invalid section'}) })));
  const show=vi.fn();
  openPartAnalysis('section',createRectanglePartDocument('Box',{widthMillimeters:10,heightMillimeters:10,depthMillimeters:10}),show);
  await vi.waitFor(()=>expect(document.querySelector('.cad-analysis-status').textContent).toContain('Invalid section'));
  expect(show.mock.calls.every(([model])=>model===null)).toBe(true);
  document.querySelector('[aria-label="Close"]').click();
});

it('shows native properties without hiding the model or assuming density',async()=>{
  const item={body_id:'body',volume_mm3:6000,area_mm2:2200,center_mm:[5,10,15],bounds_mm:[10,20,30]};
  const fetch=vi.fn(async(_url,options)=>{
    const density=JSON.parse(options.body).analysis.density_kg_m3;
    return {ok:true,json:async()=>({status:'ok',bodies:[],measurements:[{...item,...(density ? {mass_kg:.0471,inertia_kg_m2:[[1,0,0],[0,2,0],[0,0,3]]}: {})}]})};
  });
  vi.stubGlobal('fetch',fetch);
  const show=vi.fn();
  openPartAnalysis('properties',createRectanglePartDocument('Box',{widthMillimeters:10,heightMillimeters:20,depthMillimeters:30}),show);
  await vi.waitFor(()=>expect(document.querySelector('table')?.textContent).toContain('6000'));
  expect(JSON.parse(fetch.mock.calls[0][1].body).analysis).not.toHaveProperty('density_kg_m3');
  expect(document.querySelector('table').textContent).not.toContain('Mass (kg)');
  const density=document.querySelector('[aria-label="Density (kg/m³)"]');
  density.value='7850';density.dispatchEvent(new Event('change'));
  await vi.waitFor(()=>expect(document.querySelector('table').textContent).toContain('0.0471'));
  expect(JSON.parse(fetch.mock.calls.at(-1)[1].body).analysis.density_kg_m3).toBe(7850);
  expect(show.mock.calls.every(([model])=>model===null)).toBe(true);
  density.value='-1';density.dispatchEvent(new Event('change'));
  await vi.waitFor(()=>expect(document.querySelector('.cad-analysis-status').textContent).toContain('Density must be positive'));
  expect(fetch).toHaveBeenCalledTimes(2);
  document.querySelector('[aria-label="Close"]').click();
});

it('converts document-unit section input to the native millimeter contract',async()=>{
  const {applyDocumentUnits,documentUnits}=await import('../document-preferences');
  const original=documentUnits();
  const fetch=vi.fn(async()=>({ok:true,json:async()=>({status:'ok',bodies:[],measurements:[]})}));
  vi.stubGlobal('fetch',fetch);
  applyDocumentUnits({length:{unit:'in',decimals:3}});
  try {
    openPartAnalysis('section',createRectanglePartDocument('Box',{widthMillimeters:10,heightMillimeters:10,depthMillimeters:10}),vi.fn());
    const input=document.querySelector('[aria-label="Section offset (in)"]');
    input.value='1';input.dispatchEvent(new Event('change'));
    await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetch.mock.calls.at(-1)[1].body).analysis.offset_mm).toBeCloseTo(25.4);
  } finally {document.querySelector('[aria-label="Close"]')?.click();applyDocumentUnits(original);}
});

it('renders native physical properties in document length and mass units',async()=>{
  const {renderPhysicalProperties}=await import('./properties');
  const table=renderPhysicalProperties([{body_id:'box',volume_mm3:25.4**3,area_mm2:6*25.4**2,center_mm:[12.7,12.7,12.7],bounds_mm:[25.4,25.4,25.4],mass_kg:.45359237}],new Map([['box','Cube']]),{length:{unit:'in',decimals:3},mass:{unit:'lb',decimals:3}});
  const rows=[...table.querySelectorAll('tr')].map(row=>[...row.children].map(cell=>cell.textContent));
  expect(rows).toContainEqual(['Volume (in³)','1']);
  expect(rows).toContainEqual(['Surface area (in²)','6']);
  expect(rows).toContainEqual(['Center of mass (in)','0.5, 0.5, 0.5']);
  expect(rows).toContainEqual(['Mass (lb)','1']);
});

it('converts document density units to kg/m³ without accepting nonpositive density',async()=>{
  const {applyDocumentUnits,documentUnits}=await import('../document-preferences');
  const original=documentUnits();
  const fetch=vi.fn(async()=>({ok:true,json:async()=>({status:'ok',bodies:[],measurements:[]})}));
  vi.stubGlobal('fetch',fetch);
  applyDocumentUnits({density:{unit:'g/cm³',decimals:3}});
  try {
    openPartAnalysis('properties',createRectanglePartDocument('Box',{widthMillimeters:10,heightMillimeters:10,depthMillimeters:10}),vi.fn());
    const input=document.querySelector('[aria-label="Density (g/cm³)"]');
    input.value='7.85';input.dispatchEvent(new Event('change'));
    await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetch.mock.calls.at(-1)[1].body).analysis.density_kg_m3).toBe(7850);
    input.value='0';input.dispatchEvent(new Event('change'));
    expect(document.querySelector('.cad-analysis-status').textContent).toContain('Density must be positive');
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {document.querySelector('[aria-label="Close"]')?.click();applyDocumentUnits(original);}
});

it('refuses exact draft analysis through an older worker',async()=>{
 const doc=createRectanglePartDocument('Draft',{widthMillimeters:20,heightMillimeters:20,depthMillimeters:10});
 doc.features.find(f=>f.type==='extrude').draftAngleDegrees=5;
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,capabilities:[]})});vi.stubGlobal('fetch',fetch);
 const {analyzePart}=await import('./part-analysis');
 await expect(analyzePart(doc,{kind:'properties'})).rejects.toThrow('does not support extrusion draft');
 expect(fetch).toHaveBeenCalledTimes(1);
});
it('refuses sketch-line analysis when the worker only supports manual directions',async()=>{
 const doc=createRectanglePartDocument('Line',{widthMillimeters:20,heightMillimeters:20,depthMillimeters:10});
 doc.features.unshift({id:'guide',name:'Guide',type:'profile',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{id:'path',type:'path',construction:true,start:[0,0],segments:[{id:'line',type:'line',end:[3,4]}]}]}});
 doc.features.find(f=>f.type==='extrude').directionReference={kind:'sketch-line',sourceFeatureId:'guide',contourId:'path',segmentId:'line'};
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,capabilities:['extrude-direction-vector']})});vi.stubGlobal('fetch',fetch);
 const {analyzePart}=await import('./part-analysis');
 await expect(analyzePart(doc,{kind:'properties'})).rejects.toThrow('does not support sketch-line');
 expect(fetch).toHaveBeenCalledTimes(1);
});
