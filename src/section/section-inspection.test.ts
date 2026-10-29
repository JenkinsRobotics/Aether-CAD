import { expect, it } from 'vitest';
import { BoxGeometry, Matrix4, Plane, Vector3 } from 'three';
import type { PartGeometryData } from '@aether/core/contracts';
import { sectionFrame, rotateSection, moveSectionTo } from './section-frame';
import { newSectionCut, DEFAULT_SECTION_PLANES, sectionClipPlane } from './section-view-store';
import { sectionInspectionGeometry } from './section-topology';
import { sectionCapGeometry } from '../viewport/section-caps';
import { inspectGeometry } from '../measure/inspection-geometry';

it('rotates around the displayed origin and measures snapped offsets from the reference face', () => {
  const cut={...newSectionCut(DEFAULT_SECTION_PLANES[0]),pivotMillimeters:[5,6,0] as const,offsetMillimeters:12};
  const before=sectionFrame(cut).point;
  const rotated={...cut,...rotateSection(cut,[35,65])};
  expect(sectionFrame(rotated).point).toEqual(before);
  const plane=sectionClipPlane(rotated)!;
  expect(new Vector3(...plane.normal).dot(new Vector3(...before))+plane.constant).toBeCloseTo(0);
  const snapped={...rotated,...moveSectionTo(rotated,[3,4,5])};
  expect(new Vector3(...sectionFrame(snapped).point).distanceTo(new Vector3(3,4,5))).toBeLessThan(1e-10);
  expect(snapped.offsetMillimeters).toBeCloseTo(new Vector3(3,4,5).dot(new Vector3(...sectionFrame(rotated).normal)));
  expect(moveSectionTo(cut,[NaN,0,0])).toEqual({});
});

it('keeps a picked side face as zero through repeated origin moves and typed offsets', () => {
  const cut={...newSectionCut({label:'Front face',originMillimeters:[30,-15,6],normal:[0,-1,0]}),offsetMillimeters:-2};
  const moved={...cut,...moveSectionTo(cut,[35,-4,7])};
  expect(moved.offsetMillimeters).toBe(-11);
  expect(moved.pivotMillimeters).toEqual([35,-15,7]);
  expect(sectionFrame(moved).point).toEqual([35,-4,7]);
  expect(sectionFrame({...moved,offsetMillimeters:-3}).point).toEqual([35,-12,7]);
  const again={...moved,...moveSectionTo(moved,[25,-18,8])};
  expect(again.offsetMillimeters).toBe(3);
  expect(sectionFrame({...again,offsetMillimeters:0}).point).toEqual([25,-15,8]);
  expect(again.plane).toBe(cut.plane);
});
it('exposes cap area, perimeter, true corners and edges, without triangle subdivision anchors', () => {
  const box=new BoxGeometry(10,20,6),cap=sectionCapGeometry(box,[new Plane(new Vector3(0,0,-1),1)]);
  const source={id:'p',name:'Plate',topology:[],faceRanges:[]} as unknown as PartGeometryData;
  const data=sectionInspectionGeometry(cap,source,['section-plane-7']);
  expect(data.topology).toHaveLength(1);
  const face=data.topology[0];
  expect(face.measurements!.areaSquareMillimeters).toBeCloseTo(200);
  expect(face.candidates.filter(c=>c.kind==='vertex')).toHaveLength(4);
  expect(face.candidates.filter(c=>c.kind==='edge-midpoint')).toHaveLength(4);
  const item={id:'section-face:p:7',partId:'p',kind:'face' as const,faceId:face.id,label:'Section'};
  const m=inspectGeometry(data,new Matrix4().makeTranslation(30,0,0),item)!;
  expect(m.perimeterMillimeters).toBeCloseTo(60);expect(m.centerMillimeters![0]).toBeCloseTo(30);
  const edge=face.candidates.find(c=>c.kind==='edge-midpoint')!;
  const e=inspectGeometry(data,new Matrix4(),{...item,kind:'edge',id:`edge:p:${edge.id}`})!;
  expect(e.endpoints).toHaveLength(2);
  expect(new Vector3(...e.endpoints![0]).distanceTo(new Vector3(...e.endpoints![1]))).toBeCloseTo(e.lengthMillimeters!);
});
it('keeps cap IDs aligned with planes that have no intersection', () => {
  const cap=sectionCapGeometry(new BoxGeometry(10,10,10),[new Plane(new Vector3(-1,0,0),50),new Plane(new Vector3(0,0,-1),1)]);
  const data=sectionInspectionGeometry(cap,{id:'p'} as PartGeometryData,['section-plane-3','section-plane-8']);
  expect(data.topology).toHaveLength(1);
  expect(data.topology[0].candidates[0].id).toBe('section-section-plane-8-center');
});

it('retains area and perimeter when a second section trims the first cap', () => {
  const cap=sectionCapGeometry(new BoxGeometry(20,20,20),[new Plane(new Vector3(-1,0,0),2),new Plane(new Vector3(0,-1,0),0)]);
  const data=sectionInspectionGeometry(cap,{id:'p'} as PartGeometryData,['section-plane-3','section-plane-8']);
  const results=data.topology.map(face=>inspectGeometry(data,new Matrix4(),{id:`section-face:p:${face.id}`,partId:'p',kind:'face',faceId:face.id,label:'Section'})!);
  expect(results.map(m=>m.areaSquareMillimeters)).toEqual([200,240]);
  expect(results.map(m=>m.perimeterMillimeters)).toEqual([60,64]);
});

it('measures a mesh area as an approximation rather than reporting missing metadata as zero', () => {
  const data={id:'p',geometryKind:'mesh',topology:[],faceRanges:[],vertices:new Float32Array([0,0,0,10,0,0,0,10,0]),triangles:new Uint32Array([0,1,2])} as unknown as PartGeometryData;
  const m=inspectGeometry(data,new Matrix4(),{id:'body:p',partId:'p',kind:'body',label:'Triangle'})!;
  expect(m.areaSquareMillimeters).toBe(50);expect(m.areaApproximate).toBe(true);expect(m.samples).toHaveLength(3);
});
