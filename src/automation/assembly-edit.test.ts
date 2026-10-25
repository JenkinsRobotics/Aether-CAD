import { expect, it } from 'vitest';
import type { AssemblyProjectionV1 } from '../cad-assembly-bridge';
import { prepareAssemblyEdit } from './assembly-edit';

const transform = {position_m:[0.01,0.02,0.03],rotation_quaternion_xyzw:[0,0,0,1]};
const projection = {
  assembly_id:'a',capabilities:{can_edit_instances:true,can_edit_connectors:true,can_edit_relations:true,can_edit_contacts:true,supported_mate_type_ids:['revolute']},
  part_definitions:[{id:'part'}],instances:[{id:'base',definition_id:'part',definition_kind:'part',rest_transform:transform,solved_world_transform:{...transform,position_m:[10,20,30]},grounded:true,suppressed:false,name:'Base'},{id:'arm',definition_id:'part',definition_kind:'part',rest_transform:transform,grounded:false}],
  connector_definitions:[{id:'axis',part_definition_id:'part'}],
  mates:[{id:'joint',name:'Pivot',type_id:'revolute',endpoint_a:{instance_id:'base',connector_definition_id:'axis'},endpoint_b:{instance_id:'arm',connector_definition_id:'axis'},controls:[],suppressed:false,
    dofs:[{id:'angle',name:'Angle',kind:'rotation',state:'free',value_rad:0.5,neutral_rad:0,limit_min_rad:-1,limit_max_rad:1},{id:'slide',name:'Slide',kind:'translation',state:'free',value_m:0.01,neutral_m:0,limit_min_m:0,limit_max_m:0.1}]}],
  relations:[{id:'ratio',reversed:true,suppressed:true}],contact_sets:[{id:'contact',suppressed:true}],
} as unknown as AssemblyProjectionV1;
const edit = (command: unknown) => prepareAssemblyEdit(projection,command);
it('changes rest placement in explicit mm without copying solved world placement or changing the input',()=>{
  const before=structuredClone(projection);
  expect(edit({type:'instance-update',id:'base',name:'Renamed'}).params).toMatchObject({instance:{rest_transform:transform,name:'Renamed'}});
  expect(edit({type:'instance-update',id:'base',position_mm:[2,3,4]}).params).toMatchObject({instance:{rest_transform:{position_m:[0.002,0.003,0.004]},grounded:true}});
  expect(edit({type:'instance-update',id:'base'}).params.instance).not.toHaveProperty('solved_world_transform');
  expect(projection).toEqual(before);
});
it('keeps other mate intent and DOF identity while converting values and limits through UI payload helpers',()=>{
  expect(edit({type:'dof-value',id:'angle',value:90,unit:'deg'}).params).toMatchObject({dof_id:'angle',value_rad:Math.PI/2});
  expect(edit({type:'dof-value',id:'slide',value:25,unit:'mm'}).params).toMatchObject({dof_id:'slide',value_m:0.025});
  const updated:any=edit({type:'dof-limits',id:'slide',minimum:5,maximum:30,unit:'mm'}).params.mate;
  expect(updated.dofs[1]).toMatchObject({name:'Slide',value_m:0.01,limit_min_m:0.005,limit_max_m:0.03});
  expect(updated.dofs[0]).toMatchObject({name:'Angle',value_rad:0.5,limit_min_rad:-1,limit_max_rad:1});
  expect((edit({type:'dof-limits',id:'angle',minimum:null,maximum:null,unit:'deg'}).params.mate as any).dofs[0]).toMatchObject({limit_min_rad:null,limit_max_rad:null});
});
it('uses definition-local connector frames and real endpoint references',()=>{
  expect(edit({type:'connector-add',part_id:'part',name:'Axis',origin_mm:[1,2,3]}).params).toMatchObject({connector:{frame_part_local:{origin_m:[0.001,0.002,0.003],primary_axis_xyz:[0,0,1]}}});
  expect(edit({type:'mate-add',kind:'revolute',name:'Pivot',a:{instance_id:'base',connector_id:'axis'},b:{instance_id:'arm',connector_id:'axis'}}).params).toMatchObject({mate:{type_id:'revolute',endpoint_b:{instance_id:'arm',connector_definition_id:'axis'}}});
  expect(edit({type:'remove',entity:'connector',id:'axis'})).toMatchObject({method:'remove_connector',params:{connector_id:'axis'}});
});
it('preserves relation/contact suppression and uses native ratio units with explicit offset conversion',()=>{
  expect(edit({type:'relation-update',id:'ratio',kind:'rack_pinion',driver_dof_id:'angle',driven_dof_id:'slide',ratio:0.005,offset:10,unit:'mm'}).params).toMatchObject({relation:{ratio:-0.005,offset_m:0.01,reversed:true,suppressed:true}});
  expect(edit({type:'contact-update',id:'contact',name:'Collision pair',instance_ids:['base','arm']}).params).toMatchObject({contact_set:{id:'contact',suppressed:true}});
});
it.each([
  {type:'instance-update',id:'missing'}, {type:'instance-update',id:'base',solved_world_transform:transform},
  {type:'instance-update',id:'base',rotation_xyzw:[0,0,0,2]}, {type:'instance-grounded',id:'base',grounded:'false'},
  {type:'dof-value',id:'angle',value:30,unit:'mm'}, {type:'dof-limits',id:'slide',minimum:3,maximum:2,unit:'mm'},
  {type:'connector-add',part_id:'part',name:'Bad',primary_axis:'positive-x',secondary_axis:'negative-x'},
  {type:'mate-add',kind:'revolute',name:'Self',a:{instance_id:'base',connector_id:'axis'},b:{instance_id:'base',connector_id:'axis'}},
  {type:'contact-add',name:'Bad',instance_ids:['base','base']},{type:'remove',entity:'__proto__',id:'base'},
])('refuses invalid or ambiguous Assembly intent %# without mutating source',command=>{
  const before=structuredClone(projection);expect(()=>edit(command)).toThrow();expect(projection).toEqual(before);
});
it('does not offer an edit whose native capability is unavailable',()=>{
  expect(()=>prepareAssemblyEdit({...projection,capabilities:{...projection.capabilities,can_edit_contacts:false}},{type:'contacts-enabled',enabled:true})).toThrow(/support/);
});

it.each(['driven','dependent','suppressed'] as const)('refuses direct %s DOF edits',state=>{
  const p=structuredClone(projection);
  const mates=p.mates.map(m=>({...m,dofs:m.dofs.map(d=>({...d,state}))}));
  for(const command of [{type:'dof-value',id:'angle',value:30,unit:'deg'},{type:'dof-limits',id:'angle',minimum:-90,maximum:90,unit:'deg'}]) {
    expect(()=>prepareAssemblyEdit({...p,mates},command)).toThrow(/active free DOF/);
  }
});
it('refuses a suppressed mate even when its projection contains a free DOF',()=>{
  expect(()=>prepareAssemblyEdit({...projection,mates:projection.mates.map(m=>({...m,suppressed:true}))},{type:'dof-value',id:'angle',value:30,unit:'deg'})).toThrow(/active free DOF/);
});
it('allows updating a relation with its own dependent endpoint but not a competing relation',()=>{
  const p={...projection,mates:projection.mates.map(m=>({...m,dofs:m.dofs.map(d=>({...d,state:d.id==='slide'?'dependent' as const:d.state}))})),
    relations:projection.relations.map(r=>({...r,driver_dof_id:'angle',driven_dof_id:'slide'}))};
  const command={kind:'rack_pinion',driver_dof_id:'angle',driven_dof_id:'slide',ratio:0.005,offset:1,unit:'mm'};
  expect(()=>prepareAssemblyEdit(p,{...command,type:'relation-add'})).toThrow(/does not exist/);
  expect(prepareAssemblyEdit(p,{...command,type:'relation-update',id:'ratio'}).method).toBe('update_relation');
});
