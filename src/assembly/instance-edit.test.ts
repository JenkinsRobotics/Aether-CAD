import { afterEach, describe, expect, it, vi } from 'vitest';
import { Euler, Quaternion } from 'three';
import type { AssemblyProjectionV1 } from '../cad-assembly-bridge';
import { instanceDraft, instanceUpdate } from './instance-edit';
import { captureInstanceEdit, configureInstanceEditing, saveInstanceEdit } from './instance-session';
const pose = { position_m: [.02, -.04, .1], rotation_quaternion_xyzw: [0, 0, 0, 1] } as const;
const instance = { id:'moving',name:'Block:2',definition_id:'part',definition_kind:'part',parent_assembly_id:'assembly',
  parent_instance_id:null,rest_transform:pose,solved_world_transform:pose,grounded:false,visible:true,suppressed:false,source_status:'resolved' };
const assembly = { revision:'1',workspace_id:'design',assembly_id:'assembly',instances:[instance],mates:[],
  capabilities:{can_edit_instances:true},part_definitions:[{id:'part',feature_document:{}}] } as unknown as AssemblyProjectionV1;
afterEach(() => configureInstanceEditing(null));
describe('component editing', () => {
  it('keeps name/display edits from writing solved placement back into design intent', () => {
    const p = {...assembly,instances:[{...assembly.instances[0],solved_world_transform:{...pose,position_m:[.2,.3,.4] as const}}]};
    const draft = instanceDraft(p.instances[0]); draft.name='Renamed'; draft.visible=false;
    const next=instanceUpdate(p,'moving',draft).instance;
    expect(next.rest_transform).toEqual(pose);expect(next.visible).toBe(false);expect(next.name).toBe('Renamed');
    expect(next).not.toHaveProperty('solved_world_transform'); expect(next).not.toHaveProperty('source_status');
    // Grounding is an explicit placement change: pin the current solved pose.
    expect(instanceUpdate(p,'moving',{...draft,grounded:true}).instance.rest_transform.position_m).toEqual([.2,.3,.4]);
  });
  it('roundtrips combined XYZ rotations and moves exactly one occurrence', () => {
    const q=new Quaternion().setFromEuler(new Euler(.2,-.4,1.1,'XYZ'));
    const p={...assembly,instances:[{...assembly.instances[0],solved_world_transform:{...pose,rotation_quaternion_xyzw:q.toArray()}}]} as AssemblyProjectionV1;
    const draft=instanceDraft(p.instances[0]);draft.positionM=[.1,.2,.3];
    const next=instanceUpdate(p,'moving',draft).instance;
    expect(next.rest_transform.position_m).toEqual([.1,.2,.3]);
    expect(Math.abs(q.dot(new Quaternion(...next.rest_transform.rotation_quaternion_xyzw)))).toBeCloseTo(1,12);
    expect(assembly.instances[0].rest_transform).toEqual(pose);
  });
  it('refuses moving a mated free component but allows its metadata and grounded anchor edits', () => {
    const p={...assembly,mates:[{suppressed:false,endpoint_a:{instance_id:'moving'},endpoint_b:{instance_id:'base'}}]} as unknown as AssemblyProjectionV1;
    const draft=instanceDraft(p.instances[0]);draft.positionM=[1,2,3];
    expect(()=>instanceUpdate(p,'moving',draft)).toThrow('mates');
    expect(()=>instanceUpdate(p,'moving',{...instanceDraft(p.instances[0]),name:'Updated'})).not.toThrow();
    expect(()=>instanceUpdate({...p,instances:[{...p.instances[0],grounded:true}]},'moving',draft)).not.toThrow();
  });
  it('rejects invalid numeric fields and stale dialog saves before invoking the worker', async () => {
    const draft=instanceDraft(assembly.instances[0]);
    expect(()=>instanceUpdate(assembly,'moving',{...draft,positionM:[NaN,0,0]})).toThrow('finite');
    expect(()=>instanceUpdate(assembly,'moving',{...draft,name:''})).toThrow('name');
    let current=assembly;const edit=vi.fn();
    configureInstanceEditing({projection:()=>current,selectedID:()=> 'moving',editable:()=>true,edit,openPart:vi.fn()});
    const captured=captureInstanceEdit();current={...assembly,revision:'2'};
    await expect(saveInstanceEdit(captured,draft,new AbortController().signal)).rejects.toThrow('changed');expect(edit).not.toHaveBeenCalled();
  });
});
