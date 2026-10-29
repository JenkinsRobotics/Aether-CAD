import {expect,it} from 'vitest';
import {scopeAssemblyProjection} from './projection-scope';
import type {AssemblyProjectionV1} from '../cad-assembly-bridge';

it('keeps broken references visible and scopes other assemblies without mutating the archive projection',()=>{
 const mate=(id:string,a:string,b:string)=>({id,endpoint_a:{instance_id:a},endpoint_b:{instance_id:b},dofs:[{id:id+'-dof'}]});
 const input={assembly_id:'current',assemblies:[{id:'current',root_instance_ids:['a','b']},{id:'other',root_instance_ids:['x','y']}],
  instances:[{id:'a'},{id:'b'}],mates:[mate('local','a','b'),mate('remote','x','y'),mate('broken','missing','a'),mate('cross','x','b')],
  relations:[{id:'remote-relation',driver_dof_id:'remote-dof',driven_dof_id:'remote-dof'},{id:'cross-relation',driver_dof_id:'remote-dof',driven_dof_id:'local-dof'}],
  contact_sets:[{id:'remote-contact',instance_ids:['x','y']},{id:'local-contact',instance_ids:['a','b']},{id:'broken-contact',instance_ids:['missing']}],
 } as unknown as AssemblyProjectionV1;
 const before=structuredClone(input), result=scopeAssemblyProjection(input);
 expect(result.mates.map(m=>m.id)).toEqual(['local','broken','cross']);
 expect(result.relations.map(r=>r.id)).toEqual(['cross-relation']);
 expect(result.contact_sets?.map(c=>c.id)).toEqual(['local-contact','broken-contact']);
 expect(input).toEqual(before);
 expect(scopeAssemblyProjection(result)).toEqual(result);
});
