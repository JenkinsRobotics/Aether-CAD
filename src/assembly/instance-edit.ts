/** Component properties edit the existing occurrence, never its shared Part. */
import { Euler, Quaternion } from 'three';
import type { AssemblyInstanceProjection, AssemblyProjectionV1 } from '../cad-assembly-bridge';

export interface InstanceDraft {
  name: string;
  positionM: [number, number, number];
  rotationRad: [number, number, number];
  grounded: boolean;
  visible: boolean;
}
export function instanceDraft(instance: AssemblyInstanceProjection): InstanceDraft {
  const pose = instance.solved_world_transform ?? instance.rest_transform;
  const rotation = new Euler().setFromQuaternion(new Quaternion(...pose.rotation_quaternion_xyzw), 'XYZ');
  return { name: instance.name, positionM: [...pose.position_m],
    rotationRad: [rotation.x, rotation.y, rotation.z], grounded: instance.grounded, visible: instance.visible };
}
export function instancePoseControlled(assembly: AssemblyProjectionV1, instance: AssemblyInstanceProjection) {
  return !instance.grounded && assembly.mates.some(mate => !mate.suppressed &&
    [mate.endpoint_a.instance_id, mate.endpoint_b.instance_id].includes(instance.id));
}
export function instanceUpdate(assembly: AssemblyProjectionV1, id: string, draft: InstanceDraft) {
  const previous = assembly.instances.find(item => item.id === id);
  if (!previous || !assembly.capabilities.can_edit_instances) throw Error('This component is no longer editable.');
  if (!draft.name.trim() || draft.name.trim().length > 180) throw Error('Enter a component name of 1–180 characters.');
  if (draft.positionM.length !== 3 || draft.rotationRad.length !== 3 ||
      draft.positionM.some(v => !Number.isFinite(v) || Math.abs(v) > 1000) ||
      draft.rotationRad.some(v => !Number.isFinite(v) || Math.abs(v) > Math.PI * 2000) ||
      typeof draft.grounded !== 'boolean' || typeof draft.visible !== 'boolean') throw Error('Enter finite position and rotation values.');
  const quaternion = new Quaternion().setFromEuler(new Euler(...draft.rotationRad, 'XYZ')).normalize();
  const original = instanceDraft(previous);
  const changed = draft.positionM.some((v, i) => Math.abs(v - original.positionM[i]) > 1e-10)
    || 1 - Math.abs(quaternion.dot(new Quaternion(...(previous.solved_world_transform ?? previous.rest_transform).rotation_quaternion_xyzw))) > 1e-10;
  if (changed && instancePoseControlled(assembly, previous)) throw Error('This component is positioned by its mates. Edit the mate value or suppress the mate before moving it.');
  const { solved_world_transform: _solved, source_status: _source, ...instance } = previous;
  return { assembly_id: assembly.assembly_id, instance: { ...instance, name: draft.name.trim(),
    grounded: draft.grounded, visible: draft.visible,
    // A name/display edit must not overwrite authored placement with a solved pose.
    rest_transform: changed || (draft.grounded && !previous.grounded)
      ? { position_m: [...draft.positionM], rotation_quaternion_xyzw: quaternion.toArray() } : instance.rest_transform,
  } };
}
