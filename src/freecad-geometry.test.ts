import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { buildWithFreeCAD } from "./freecad-geometry";
import { faceIdForTriangle } from "./viewport/picking-math";
afterEach(() => vi.unstubAllGlobals());

it('refuses connected regions on an older worker and checks again after reconnecting', async () => {
  const features = [{ id: 'region', kind: 'sketch-region' as const, parameters: { profiles: ['curve', 'line'] } }];
  const fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, capabilities: ['sketch-wire'] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, capabilities: ['sketch-wire', 'sketch-connected-region'] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ok', diagnostics: [], bodies: [] }) });
  vi.stubGlobal('fetch', fetch);
  await expect(buildWithFreeCAD(features)).rejects.toThrow(/connected sketch regions/);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((await buildWithFreeCAD(features)).diagnostics).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it.each([
  ['sketch-fixed-geometry', {blocked_geometry:[0]}, /whole-entity sketch Fix/],
  ['sketch-ellipse', {segments:[{type:'ellipse'}]}, /exact sketch ellipses/],
  ['sketch-conic', {segments:[{type:'conic'}]}, /exact sketch conics/],
  ['sketch-pierce', {pierce_checks:[{id:'pierce-1'}]}, /associative Pierce constraints/],
] as const)('refuses %s on an older worker before geometry is requested',async(capability,parameters,message)=>{
 const features=[{id:'s',kind:'sketch-wire' as const,parameters}];
 const fetch=vi.fn()
  .mockResolvedValueOnce({ok:true,json:async()=>({ok:true,capabilities:['sketch-wire']})})
  .mockResolvedValueOnce({ok:true,json:async()=>({ok:true,capabilities:['sketch-wire',capability]})})
  .mockResolvedValueOnce({ok:true,json:async()=>({status:'ok',diagnostics:[],bodies:[]})});
 vi.stubGlobal('fetch',fetch);
 await expect(buildWithFreeCAD(features)).rejects.toThrow(message);expect(fetch).toHaveBeenCalledTimes(1);
 expect((await buildWithFreeCAD(features)).diagnostics).toEqual([]);expect(fetch).toHaveBeenCalledTimes(3);
});

it('decodes preview axes without turning transient metadata into selectable geometry',async()=>{
 const axis={side:'primary',parameter:'distance',originMillimeters:[0,0,12],direction:[0,0,1],scale:.5,reversed:false};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({status:'ok',diagnostics:[],bodies:[],preview:{base:[],added:[],removed:[],feature_id:'e',extrusion_axes:[axis]}})}));
 const model=await buildWithFreeCAD([]);expect(model.parts).toEqual([]);expect(model.featurePreview).toMatchObject({featureId:'e',extrusionAxes:[axis]});
});
it('decodes a native transform anchor as display metadata, without adding a selectable body',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({status:'ok',diagnostics:[],bodies:[],preview:{base:[],added:[],removed:[],feature_id:'t',transform_frame:{center_mm:[5,10,2.5],radius_mm:12}}})}));
 const model=await buildWithFreeCAD([]);expect(model.parts).toEqual([]);expect(model.featurePreview).toMatchObject({featureId:'t',transformFrame:{centerMillimeters:[5,10,2.5],radiusMillimeters:12}});
});

it("draws every cylinder triangle and picks both caps using native triangle ranges", async () => {
  // Three faces from an actual radius-10, depth-20 native cylinder: wall, caps.
  const ranges = [{ start: 0, count: 252, faceId: 11 }, { start: 252, count: 124, faceId: 22 }, { start: 376, count: 124, faceId: 33 }];
  const indices = Array.from({ length: 1500 }, (_, i) => i);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    status: "ok", diagnostics: [], bodies: [{ volume_mm3: Math.PI * 100 * 20,
      vertices: [], normals: [], triangles: indices, edge_lines: [],
      face_ranges: ranges, topology: [], face_names: [] }],
  }) }));
  const result = await buildWithFreeCAD([]);
  const part = result.parts[0];
  const geometry = new THREE.BufferGeometry(); geometry.setIndex(new THREE.BufferAttribute(part.triangles, 1));
  for (const range of part.faceRanges) geometry.addGroup(range.start, range.count, 0);
  const drawn = geometry.groups.flatMap(g => Array.from({ length: g.count }, (_, i) => g.start + i));
  expect(drawn).toEqual(indices); // no missing, overlapping, or partial faces
  for (let triangle = 0; triangle < 500; triangle++) {
    expect(faceIdForTriangle(part.faceRanges, triangle)).toBe(triangle < 252 ? 11 : triangle < 376 ? 22 : 33);
  }
  geometry.dispose();
});
it('preserves optional native face and edge measurements in the browser projection',async()=>{
 const measurements={areaSquareMillimeters:100,radiusMillimeters:5},surfaceReference={surfaceType:'cylinder',faceAnchor:{centerMillimeters:[1,2,3],areaSquareMillimeters:100}};
 const candidate={id:'edge',faceId:1,kind:'edge-midpoint',label:'Arc',origin:[0,0,0],xAxis:[1,0,0],yAxis:[0,1,0],zAxis:[0,0,1],measurements:{lengthMillimeters:31.4159,radiusMillimeters:5,centerMillimeters:[2,3,4]}};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({status:'ok',diagnostics:[],bodies:[{id:'body',volume_mm3:100,vertices:[],normals:[],triangles:[],edge_lines:[],face_ranges:[],face_names:[],topology:[{id:1,surfaceType:'CYLINDRE',surfaceReference,measurements,candidates:[candidate]}]}]})}));
 const result=await buildWithFreeCAD([]);
 expect(result.parts[0].topology[0].measurements).toEqual(measurements);
 expect(result.parts[0].topology[0].surfaceReference).toEqual(surfaceReference);
 expect(result.parts[0].topology[0].candidates[0].measurements).toEqual(candidate.measurements);
});

it('retains reference mesh identity without claiming exact face topology',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({status:'ok',diagnostics:[],bodies:[{id:'mesh',geometry_kind:'mesh',volume_mm3:0,vertices:[0,0,0,1,0,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],triangles:[0,1,2],edge_lines:[],face_ranges:[],topology:[],face_names:[]} ]})}));
 const {parts}=await buildWithFreeCAD([]);
 expect(parts[0].geometryKind).toBe('mesh');expect(parts[0].triangles).toHaveLength(3);
 expect(parts[0].faceRanges).toEqual([]);expect(parts[0].topology).toEqual([]);
});

it.each([[],undefined])('rejects draft on a worker without the capability before requesting geometry',async capabilities=>{
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,engine:'FreeCAD',capabilities})});vi.stubGlobal('fetch',fetch);
 await expect(buildWithFreeCAD([{id:'e',kind:'pad',parameters:{draft_angle_deg:5}}])).rejects.toThrow('does not support extrusion draft');
 expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][0]).toBe('/api/cad/engine');
});
it('checks the current worker on every drafted build and preserves native diagnostics',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({ok:true,capabilities:['extrude-draft']})})
 .mockResolvedValueOnce({ok:true,json:async()=>({status:'error',diagnostics:[{feature_id:'e',severity:'error',message:'Draft collapses'}],bodies:[]})})
 .mockResolvedValueOnce({ok:true,json:async()=>({ok:true,capabilities:[]})});vi.stubGlobal('fetch',fetch);
 const features=[{id:'e',kind:'pad' as const,parameters:{draft_angle_deg:70}}];
 expect((await buildWithFreeCAD(features)).diagnostics[0].message).toBe('Draft collapses');
 await expect(buildWithFreeCAD(features)).rejects.toThrow('does not support extrusion draft');
 expect(fetch).toHaveBeenCalledTimes(3);
});
it.each([{second_end:{end_type:'blind',distance_mm:5}},{draft_angle_deg:5,end_type:'symmetric'},{draft_angle_deg:5,second_distance_mm:5}])('rejects newer end semantics on a draft-only worker',async parameters=>{
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,capabilities:['extrude-draft']})});vi.stubGlobal('fetch',fetch);
 await expect(buildWithFreeCAD([{id:'e',kind:'pad',parameters}])).rejects.toThrow('does not support independent extrusion ends');
 expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(['up-to-next','up-to-face','through-all'])('rejects drafted %s limits on an older worker, including the opposite end',async end_type=>{
 for(const opposite of [false,true]){
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,capabilities:['extrude-draft','extrude-independent-ends']})});vi.stubGlobal('fetch',fetch);
  const end={end_type,draft_angle_deg:5,distance_mm:1};
  await expect(buildWithFreeCAD([{id:'e',kind:'pad',parameters:opposite?{second_end:end}:end}])).rejects.toThrow('does not support drafted extrusion limits');
  expect(fetch).toHaveBeenCalledTimes(1);
 }
});
it('builds drafted stopping references only after the live worker advertises them',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({ok:true,capabilities:['extrude-draft','extrude-drafted-limits']})})
 .mockResolvedValueOnce({ok:true,json:async()=>({status:'ok',bodies:[],diagnostics:[]})});vi.stubGlobal('fetch',fetch);
 const features=[{id:'e',kind:'pad' as const,parameters:{end_type:'up-to-face',draft_angle_deg:5,end_reference:{sourceFeatureId:'stop'}}}];
 expect((await buildWithFreeCAD(features)).diagnostics).toEqual([]);
 expect(JSON.parse(fetch.mock.calls[1][1].body).features).toEqual(features);
});

it.each([{direction_vector:[.6,0,.8]},{end_type:'symmetric-through-all'}])('rejects direction and symmetric Through-all on older workers',async parameters=>{
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,capabilities:['extrude-draft','extrude-independent-ends','extrude-drafted-limits']})});vi.stubGlobal('fetch',fetch);
 await expect(buildWithFreeCAD([{id:'e',kind:'pad',parameters}])).rejects.toThrow(/does not support/);expect(fetch).toHaveBeenCalledTimes(1);
});

it('requires the live sketch-line direction capability before building',async()=>{
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,capabilities:['extrude-direction-vector']})});vi.stubGlobal('fetch',fetch);
 await expect(buildWithFreeCAD([{id:'e',kind:'pad',parameters:{direction_reference:{kind:'sketch-line'}}}])).rejects.toThrow(/does not support sketch-line/);
 expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([false,true])('requires current next-boundary support on either non-drafted end (opposite=%s)',async opposite=>{
 const features=[{id:'e',kind:'pad' as const,parameters:opposite?{second_end:{end_type:'up-to-next',distance_mm:1}}:{end_type:'up-to-next'}}];
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({ok:true,capabilities:['extrude-independent-ends']})})
 .mockResolvedValueOnce({ok:true,json:async()=>({ok:true,capabilities:['extrude-general-next','extrude-independent-ends']})})
 .mockResolvedValueOnce({ok:true,json:async()=>({status:'ok',bodies:[],diagnostics:[]})});vi.stubGlobal('fetch',fetch);
 await expect(buildWithFreeCAD(features)).rejects.toThrow('does not support general Up to next');
 expect(fetch).toHaveBeenCalledTimes(1);
 expect((await buildWithFreeCAD(features)).diagnostics).toEqual([]);
 expect(JSON.parse(fetch.mock.calls[2][1].body).features).toEqual(features);
});

it.each([false,true])('requires curved drafted-next support on the current worker (opposite=%s)',async opposite=>{
 const end={end_type:'up-to-next',draft_angle_deg:3,distance_mm:1};
 const features=[{id:'e',kind:'pad' as const,parameters:opposite?{second_end:end}:end}];
 const previous=['extrude-general-next','extrude-draft','extrude-drafted-limits','extrude-independent-ends'];
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({ok:true,capabilities:previous})})
 .mockResolvedValueOnce({ok:true,json:async()=>({ok:true,capabilities:[...previous,'extrude-drafted-general-next']})})
 .mockResolvedValueOnce({ok:true,json:async()=>({status:'ok',bodies:[],diagnostics:[]})});vi.stubGlobal('fetch',fetch);
 await expect(buildWithFreeCAD(features)).rejects.toThrow('does not support drafted general Up to next');
 expect(fetch).toHaveBeenCalledTimes(1);
 expect((await buildWithFreeCAD(features)).diagnostics).toEqual([]);
 expect(JSON.parse(fetch.mock.calls[2][1].body).features).toEqual(features);
});

it.each([false,true])('requires curved face support before building either end (opposite=%s)',async opposite=>{
 const end={end_type:'up-to-face',end_reference:{surfaceType:'cylinder'}};
 const features=[{id:'e',kind:'pad' as const,parameters:opposite?{second_end:end}:end}];
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({ok:true,capabilities:['extrude-independent-ends']})})
 .mockResolvedValueOnce({ok:true,json:async()=>({ok:true,capabilities:['extrude-independent-ends','extrude-curved-face']})})
 .mockResolvedValueOnce({ok:true,json:async()=>({status:'ok',bodies:[],diagnostics:[]})});vi.stubGlobal('fetch',fetch);
 await expect(buildWithFreeCAD(features)).rejects.toThrow('does not support curved Up to face');expect(fetch).toHaveBeenCalledTimes(1);
 expect((await buildWithFreeCAD(features)).diagnostics).toEqual([]);
 expect(JSON.parse(fetch.mock.calls[2][1].body).features).toEqual(features);
});

it('refuses direct face offset on an old worker before sending geometry',async()=>{
 const features=[{id:'offset',kind:'offset-face' as const,parameters:{distance_mm:1,faces:[]}}];
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({ok:true,capabilities:[]})})
 .mockResolvedValueOnce({ok:true,json:async()=>({ok:true,capabilities:['offset-face']})})
 .mockResolvedValueOnce({ok:true,json:async()=>({status:'ok',bodies:[],diagnostics:[]})});vi.stubGlobal('fetch',fetch);
 await expect(buildWithFreeCAD(features)).rejects.toThrow('does not support direct face offsets');expect(fetch).toHaveBeenCalledTimes(1);
 expect((await buildWithFreeCAD(features)).diagnostics).toEqual([]);expect(JSON.parse(fetch.mock.calls[2][1].body).features).toEqual(features);
});

it('refuses part transforms on an old worker before sending geometry',async()=>{
 const features=[{id:'offset',kind:'transform' as const,parameters:{distance_mm:1,faces:[]}}];
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({ok:true,capabilities:[]})})
 .mockResolvedValueOnce({ok:true,json:async()=>({ok:true,capabilities:['part-transform']})})
 .mockResolvedValueOnce({ok:true,json:async()=>({status:'ok',bodies:[],diagnostics:[]})});vi.stubGlobal('fetch',fetch);
 await expect(buildWithFreeCAD(features)).rejects.toThrow('does not support solid part transforms');expect(fetch).toHaveBeenCalledTimes(1);
 expect((await buildWithFreeCAD(features)).diagnostics).toEqual([]);expect(JSON.parse(fetch.mock.calls[2][1].body).features).toEqual(features);
});
it('refuses referenced transforms on a worker that only supports numeric transforms',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,capabilities:['part-transform']})}));
 await expect(buildWithFreeCAD([{id:'r',kind:'transform',parameters:{body_ids:['body'],transform:{kind:'translate-reference',reference:{}}}}])).rejects.toThrow('does not support geometry-referenced transforms');
 expect(fetch).toHaveBeenCalledTimes(1);
});

it('requires solid-edge capability and preserves native endpoint anchors',async()=>{
 const capabilities=['part-transform','referenced-part-transform'];
 const candidate={id:'edge',kind:'edge-midpoint',edgeAnchor:{start:{signature:'a'},end:{signature:'b'}},measurements:{linearDirection:[0,0,1]}};
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({ok:true,capabilities})})
 .mockResolvedValueOnce({ok:true,json:async()=>({ok:true,capabilities:[...capabilities,'solid-edge-transform']})})
 .mockResolvedValueOnce({ok:true,json:async()=>({status:'ok',diagnostics:[],bodies:[{id:'body',volume_mm3:1,vertices:[],normals:[],triangles:[],edge_lines:[],face_ranges:[],face_names:[],topology:[{id:1,candidates:[candidate]}]}]})});vi.stubGlobal('fetch',fetch);
 const features=[{id:'t',kind:'transform' as const,parameters:{body_ids:['body'],transform:{kind:'translate-reference',reference:{kind:'solid-edge',anchor:candidate.edgeAnchor}}}}];
 await expect(buildWithFreeCAD(features)).rejects.toThrow(/does not support solid.edge/);expect(fetch).toHaveBeenCalledTimes(1);
 const model=await buildWithFreeCAD(features);expect(model.parts[0].topology[0].candidates[0].edgeAnchor).toEqual(candidate.edgeAnchor);
 expect(JSON.parse(fetch.mock.calls[2][1].body).features).toEqual(features);
});

it('refuses face movement on offset-only workers before requesting geometry',async()=>{
 const features=[{id:'move',kind:'offset-face' as const,parameters:{faces:[],transform:{kind:'translate',translationMillimeters:[0,0,1]}}}];
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({ok:true,capabilities:['offset-face']})}).mockResolvedValueOnce({ok:true,json:async()=>({ok:true,capabilities:['offset-face','move-face']})}).mockResolvedValueOnce({ok:true,json:async()=>({status:'ok',diagnostics:[],bodies:[]})});vi.stubGlobal('fetch',fetch);
 await expect(buildWithFreeCAD(features)).rejects.toThrow('does not support face translation and rotation');expect(fetch).toHaveBeenCalledTimes(1);
 expect((await buildWithFreeCAD(features)).diagnostics).toEqual([]);expect(JSON.parse(fetch.mock.calls[2][1].body).features).toEqual(features);
});
