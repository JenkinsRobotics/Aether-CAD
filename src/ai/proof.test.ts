import {expect,it,vi} from 'vitest';
import {createEmptyPartDocument} from '@aether/core/document';
vi.mock('../modeling/part-analysis',()=>({analyzePart:vi.fn()}));
import {analyzePart} from '../modeling/part-analysis';
import {verifyPart} from './proof';

it('returns paged exact measurements and forwards density in explicit units',async()=>{
  const measurements=Array.from({length:21},(_,i)=>({body_id:`body${i}`,volume_mm3:40000,area_mm2:10600,center_mm:[40,25,5],bounds_mm:[80,50,10]}));
  vi.mocked(analyzePart).mockResolvedValue({status:'ok',measurements});
  const doc=createEmptyPartDocument('Plate'),signal=new AbortController().signal;
  const result=await verifyPart(doc,{density_kg_m3:7800},signal);
  expect(analyzePart).toHaveBeenLastCalledWith(doc,{kind:'properties',density_kg_m3:7800},signal);
  expect(result.measurements).toEqual(measurements.slice(0,20));expect(result.next_offset).toBe(20);
  expect((await verifyPart(doc,{offset:20},signal)).measurements).toEqual([measurements[20]]);
  expect(doc.features).toHaveLength(0);
});
it.each([{density_kg_m3:0},{density_kg_m3:Infinity},{density_kg_m3:'steel'},{offset:-1},{offset:2.5}])('rejects invalid analysis input',async args=>{
  await expect(verifyPart(createEmptyPartDocument('Part'),args,new AbortController().signal)).rejects.toThrow();
});
