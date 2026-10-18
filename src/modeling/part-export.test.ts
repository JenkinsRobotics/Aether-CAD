import { afterEach, expect, it, vi } from "vitest";
import { createEmptyPartDocument, insertFeature } from "@aether/core/document";
import { createPartExport } from "./part-export";
afterEach(() => vi.unstubAllGlobals());
function part() {
  let doc = createEmptyPartDocument("Plate");
  doc = insertFeature(doc, { id: "s", type: "profile", name: "Sketch", suppressed: false, plane: "XY", offsetMillimeters: 0, profile: { type: "circle", radiusMillimeters: 5, centerMillimeters: [0, 0] } });
  return insertFeature(doc, { id: "p", type: "extrude", name: "Pad", suppressed: false, profileFeatureId: "s", distanceMillimeters: 10, operation: "new" });
}
it("exports the current feature definition and selected body, not display geometry", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "ok", format: "step", data_base64: btoa("ISO-10303-21;") }) });
  vi.stubGlobal("fetch", fetch);
  const blob = await createPartExport(part(), "step", "body-1");
  expect(await blob.text()).toBe("ISO-10303-21;");
  const payload = JSON.parse(fetch.mock.calls[0][1].body);
  expect(payload.body_ids).toEqual(["body-1"]);
  expect(payload.features.at(-1)).toMatchObject({ kind: "pad", parameters: { distance_mm: 10 } });
});
it("does not download a partial native build", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "error", diagnostics: [{ message: "Pad failed" }] }) }));
  await expect(createPartExport(part(), "stl")).rejects.toThrow("Pad failed");
});
it('refuses exporting draft geometry through an older worker',async()=>{
 const doc=part();Object.assign(doc.features.at(-1)!,{draftAngleDegrees:5});
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,capabilities:[]})});vi.stubGlobal('fetch',fetch);
 await expect(createPartExport(doc,'step')).rejects.toThrow('does not support extrusion draft');
 expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][0]).toBe('/api/cad/engine');
});
it('refuses a sketch-line extrusion export when the worker only supports manual directions',async()=>{
 const doc=part();
 doc.features.unshift({id:'guide',name:'Guide',type:'profile',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{id:'path',type:'path',construction:true,start:[0,0],segments:[{id:'line',type:'line',end:[3,4]}]}]}});
 Object.assign(doc.features.at(-1)!,{directionReference:{kind:'sketch-line',sourceFeatureId:'guide',contourId:'path',segmentId:'line'}});
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,capabilities:['extrude-direction-vector']})});vi.stubGlobal('fetch',fetch);
 await expect(createPartExport(doc,'step')).rejects.toThrow('does not support sketch-line');
 expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][0]).toBe('/api/cad/engine');
});
