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



it('renders native physical properties in document length and mass units',async()=>{
  const {renderPhysicalProperties}=await import('./properties');
  const table=renderPhysicalProperties([{body_id:'box',volume_mm3:25.4**3,area_mm2:6*25.4**2,center_mm:[12.7,12.7,12.7],bounds_mm:[25.4,25.4,25.4],mass_kg:.45359237}],new Map([['box','Cube']]),{length:{unit:'in',decimals:3},mass:{unit:'lb',decimals:3}});
  const rows=[...table.querySelectorAll('tr')].map(row=>[...row.children].map(cell=>cell.textContent));
  expect(rows).toContainEqual(['Volume (in³)','1']);
  expect(rows).toContainEqual(['Surface area (in²)','6']);
  expect(rows).toContainEqual(['Center of mass (in)','0.5, 0.5, 0.5']);
  expect(rows).toContainEqual(['Mass (lb)','1']);
});


