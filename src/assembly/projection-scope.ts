import type { AssemblyProjectionV1 } from '../cad-assembly-bridge';

/** The portable codec projects active instances but retains workspace-wide mate
 * metadata. Ignore only entities proven to belong to another assembly. Unknown
 * or crossing references remain present so ordinary validation still reports them. */
export function scopeAssemblyProjection(projection: AssemblyProjectionV1): AssemblyProjectionV1 {
  const active = new Set(projection.instances.map(instance => instance.id));
  const elsewhere = new Set((projection.assemblies ?? [])
    .filter(assembly => assembly.id !== projection.assembly_id)
    .flatMap(assembly => assembly.root_instance_ids ?? [])
    .filter(id => !active.has(id)));
  if (!elsewhere.size) return projection;
  const omitted = projection.mates.filter(mate =>
    elsewhere.has(mate.endpoint_a.instance_id) && elsewhere.has(mate.endpoint_b.instance_id));
  const omittedIDs = new Set(omitted.map(mate => mate.id));
  const omittedDOFs = new Set(omitted.flatMap(mate => (mate.dofs ?? []).map(dof => dof.id)));
  return {
    ...projection,
    mates: projection.mates.filter(mate => !omittedIDs.has(mate.id)),
    relations: (projection.relations ?? []).filter(relation =>
      !(omittedDOFs.has(relation.driver_dof_id) && omittedDOFs.has(relation.driven_dof_id))),
    ...(projection.contact_sets ? { contact_sets: projection.contact_sets.filter(set =>
      !set.instance_ids.length || !set.instance_ids.every(id => elsewhere.has(id))) } : {}),
  };
}
