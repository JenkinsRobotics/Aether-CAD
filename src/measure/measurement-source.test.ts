import { expect, it, vi } from 'vitest';
import { Matrix4 } from 'three';
import type { PartDocument } from '@aether/core/document';
import { sourceDistance, sourceProperties, type MeasurementSource } from './measurement-source';
import type { CADSelectionItem } from '../cad-selection-store';
const analyzePart=vi.fn();
vi.mock('../modeling/part-analysis',()=>({analyzePart:(...args:unknown[])=>analyzePart(...args)}));
const document={documentId:'source'} as PartDocument;
const source=(bodyId:string,instanceId='instance'):MeasurementSource=>({document,bodyId,instanceId,placement:new Matrix4().makeTranslation(40,50,60)});
const item=(id:string):CADSelectionItem=>({id:`body:assembly:instance:${id}`,kind:'body',partId:`assembly:instance:${id}`,label:id});
it('queries exact local references and returns distances at the displayed instance placement',async()=>{
  analyzePart.mockResolvedValue({measurements:[{distance_mm:5,points:[[0,0,0],[3,4,0]]}]});
  const result=await sourceDistance([item('a'),item('b')],[source('a'),source('b')],new AbortController().signal);
  expect(analyzePart).toHaveBeenLastCalledWith(document,{kind:'distance',entities:[{body_id:'a'},{body_id:'b'}]},expect.anything());
  expect(result!.points).toEqual([[40,50,60],[43,54,60]]);expect(result!.distance_mm).toBe(5);
  expect(await sourceDistance([item('a'),item('b')],[source('a'),source('b','other')],new AbortController().signal)).toBeNull();
});
it('retains exact volume and area while placing the center and relabeling local dimensions',async()=>{
  analyzePart.mockResolvedValue({measurements:[{body_id:'a',volume_mm3:1000,area_mm2:600,center_mm:[5,5,5],bounds_mm:[10,10,10]}]});
  const values=await sourceProperties([item('a')],[source('a')],new AbortController().signal);
  expect(values[0]).toEqual({body_id:'assembly:instance:a',volume_mm3:1000,area_mm2:600,center_mm:[45,55,65],bounds_mm:[10,10,10],boundsInPartCoordinates:true});
});
