import { afterEach, expect, it, vi } from "vitest";
import { createEmptyPartDocument, insertFeature, type PartDocument } from "@aether/core/document";
vi.mock("@aether/core/kernel", () => ({ OCCTWorkerClient: class { ready = Promise.resolve(); } }));
import { HostAetherCoreClient } from "./host-aether-core-client";

afterEach(() => vi.unstubAllGlobals());
const part = (): PartDocument => {
  let doc = createEmptyPartDocument("Bracket");
  doc = insertFeature(doc, { id: "s", type: "profile", name: "Sketch", plane: "XY", offsetMillimeters: 0, suppressed: false,
    profile: { type: "drawing", contours: [0, 10, 20].map(x => ({ type: "circle" as const, id: `c${x}`, center: [x, 0] as [number, number], radius: 2 })) } });
  doc = insertFeature(doc, { id: "e", type: "extrude", name: "Extrude", profileFeatureId: "s", profileContourId: "c20", operation: "new", distanceMillimeters: 6, suppressed: false });
  return { ...doc, rollbackIndex: 2 };
};
const body = { volume_mm3: 24 * Math.PI, vertices: [], normals: [], triangles: [], edge_lines: [], face_ranges: [], topology: [], face_count: 0, edge_count: 0, face_names: [] };
it("sends every expanded region and pad without reapplying document rollback; retains body identity", async () => {
  const fetch = vi.fn(async (_url: string, _options: RequestInit) => new Response(JSON.stringify({ status: "ok", bodies: [body], diagnostics: [] })));
  vi.stubGlobal("fetch", fetch);
  const doc = part();
  const result = await new HostAetherCoreClient().evaluatePart(doc);
  const request = JSON.parse(fetch.mock.calls[0][1]!.body as string);
  expect(request.rollback).toBeNull();
  expect(request.features.map((f: {id: string}) => f.id)).toEqual(["s#0", "s#1", "s#2", "e"]);
  expect(result.parts[0].id).toBe(`${doc.documentId}:body-1`);
});
it("rejects a partial solid even when the backend status says ok", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "ok", bodies: [body], diagnostics: [{ feature_id: "e", severity: "error", message: "Pad failed" }] }))));
  await expect(new HostAetherCoreClient().evaluatePart(part())).rejects.toThrow("Extrude: Pad failed");
});
it("refuses untranslatable features before requesting misleading partial geometry", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const doc = part(); doc.rollbackIndex = undefined;
  doc.features.push({ id: "m", name: "Mirror", type: "mirror", suppressed: false, operation: "cut", plane: "YZ", offsetMillimeters: 0, sourceFeatureId: "e" });
  await expect(new HostAetherCoreClient().evaluatePart(doc)).rejects.toThrow("Mirror:");
  expect(fetch).not.toHaveBeenCalled();
});
it("refuses a server that merges two New bodies into one", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "ok", bodies: [body], diagnostics: [] }))));
  const doc = part(); doc.rollbackIndex = undefined;
  const next = insertFeature(doc, { id: "e2", name: "Second body", type: "extrude", suppressed: false, operation: "new", profileFeatureId: "s", profileContourId: "c0", distanceMillimeters: 10 });
  await expect(new HostAetherCoreClient().evaluatePart(next)).rejects.toThrow("number of bodies");
});
it("resolves native separate outputs without changing the candidate document", async () => {
  const doc = part(); const feature = doc.features[1];
  if (feature.type !== "extrude") throw new Error("fixture");
  feature.separateBodies = true;
  feature.regionMode = "faces";
  feature.profileContourIds = ["c0", "c20"];
  const ids = [`${feature.bodyId}:solid-left`, `${feature.bodyId}:solid-right`];
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "ok", bodies: ids.map(id => ({ ...body, id })), body_outputs: { e: ids }, diagnostics: [] }))));
  const result = await new HostAetherCoreClient().evaluatePart(doc);
  expect(result.parts.map(p => p.id)).toEqual(ids);
  expect(result.bodyOutputs).toEqual({ e: ids });
  expect(feature.bodyOutputs).toBeUndefined();
});
it("rejects mismatched body identities even when the body count agrees", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "ok", bodies: [{ ...body, id: "wrong" }], diagnostics: [] }))));
  await expect(new HostAetherCoreClient().evaluatePart(part())).rejects.toThrow("identities");
});
it('requests transient preview geometry only for the final active feature and decodes colors separately from bodies',async()=>{
 const fetch=vi.fn(async()=>new Response(JSON.stringify({status:'ok',bodies:[body],diagnostics:[],preview:{base:[],added:[{...body,id:'preview:added:new'}],removed:[]}})));
 vi.stubGlobal('fetch',fetch);
 const result=await new HostAetherCoreClient().evaluatePart(part(),{preview:true});
 expect(JSON.parse((fetch.mock.calls[0] as unknown as [string,RequestInit])[1].body as string).preview_feature_id).toBe('e');
 expect(result.parts).toHaveLength(1);expect(result.featurePreview!.added[0].vertices).toBeInstanceOf(Float32Array);
 expect(result.featurePreviewUnavailable).toBe(false);
});
it('retains ordinary result previews with an explicit capability flag for an older host',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({status:'ok',bodies:[body],diagnostics:[]}))));
 expect((await new HostAetherCoreClient().evaluatePart(part(),{preview:true})).featurePreviewUnavailable).toBe(true);
 expect((await new HostAetherCoreClient().evaluatePart(part())).featurePreviewUnavailable).toBe(false);
});

it('adopts automatic scope after original producer outputs before checking final body identities',async()=>{
 const doc=part();doc.rollbackIndex=undefined;
 const feature=doc.features[1];if(feature.type!=='extrude')throw Error('fixture');
 feature.separateBodies=true;feature.regionMode='faces';feature.profileContourIds=['c0','c20'];
 const ids=[`${feature.bodyId}:solid-left`,`${feature.bodyId}:solid-right`];
 doc.features.push({id:'merge',type:'extrude',name:'Automatic Add',operation:'add',profileFeatureId:'s',profileContourId:'c0',distanceMillimeters:10,scopeMode:'all',suppressed:false});
 const scope={merge:{targets:ids,groups:[{bodyId:ids[0],sources:ids}]}};
 let returnedScope:unknown=scope;
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url==='/api/cad/engine'?{ok:true,capabilities:['extrude-automatic-scope']}:{status:'ok',bodies:[{...body,id:ids[0]}],body_outputs:{e:ids},scope_resolutions:returnedScope,diagnostics:[]}))));
 const result=await new HostAetherCoreClient().evaluatePart(doc);
 expect(result.parts.map(p=>p.id)).toEqual([ids[0]]);expect(result.scopeResolutions).toEqual(scope);expect(result.bodyOutputs).toEqual({e:ids});
 expect(doc.features.at(-1)).not.toHaveProperty('scopeResolution');expect(feature.bodyOutputs).toBeUndefined();
 returnedScope={};await expect(new HostAetherCoreClient().evaluatePart(doc)).rejects.toThrow('did not resolve');
 returnedScope={merge:{targets:['foreign'],groups:[]}};await expect(new HostAetherCoreClient().evaluatePart(doc)).rejects.toThrow('unavailable scope part');
});
