import type { AssemblyMutationMethod, AssemblyProjectionV1 } from '../cad-assembly-bridge';
import { assemblyMateDOFEditorDraft, assemblyMateDOFLimitsPayload, assemblyMateDOFValuePayload, assemblyMatePayload, assemblyMateTypeOptions, assemblyMateUpdatePayload } from '../cad-mate-authoring';
import { connectorAxisOptions, normalizeAssemblyConnectorDraft, type ConnectorAxisID } from '../cad-connector-authoring';
import { assemblyRelationKindOptions, assemblyRelationPayload, type AssemblyRelationKind } from '../cad-relation-authoring';

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('An Assembly command object is required.'); return value as ObjectValue; }
function fields(value: ObjectValue, allowed: string[]): void { if (Object.keys(value).some(key => !allowed.includes(key))) throw Error('Unknown Assembly command field.'); }
function text(value: unknown): string { if (typeof value !== 'string' || !value.trim() || value.length > 1000) throw Error('Provide a nonempty Assembly name or ID of at most 1000 characters.'); return value; }
function finite(value: unknown): number { if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('Provide a finite Assembly value.'); return value; }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') throw Error('Provide an explicit boolean.'); return value; }
function vector(value: unknown, size: number): number[] { if (!Array.isArray(value) || value.length !== size) throw Error(`Provide ${size} finite coordinates.`); return value.map(finite); }
function found<T extends { readonly id: string }>(items: readonly T[], value: unknown): T { const id = text(value), item = items.find(item => item.id === id); if (!item) throw Error('Assembly entity does not exist. Inspect its current IDs.'); return item; }
function capability(available: boolean | undefined): void { if (!available) throw Error('This Assembly does not support that edit.'); }

/** Translate explicit user units/IDs into the same validated operation payloads
 * used by assembly controls. No selection state or second assembly model. */
export function prepareAssemblyEdit(assembly: AssemblyProjectionV1, value: unknown): { method: AssemblyMutationMethod; params: ObjectValue } {
  const c = object(value), type = text(c.type);
  const result = (method: AssemblyMutationMethod, params: ObjectValue) => ({ method, params: { assembly_id: assembly.assembly_id, ...params } });
  if (type === 'instance-update') {
    fields(c, ['type','id','name','position_mm','rotation_xyzw','visible']); capability(assembly.capabilities.can_edit_instances);
    const item = found(assembly.instances, c.id);
    const { solved_world_transform: _solved, source_status: _source, ...instance } = item;
    const transform = structuredClone(instance.rest_transform);
    const rotation = c.rotation_xyzw === undefined ? [...transform.rotation_quaternion_xyzw] : vector(c.rotation_xyzw, 4);
    if (Math.abs(Math.hypot(...rotation) - 1) > 1e-6) throw Error('Assembly rotation must be a unit quaternion.');
    return result('update_instance', { instance: { ...instance, ...(c.name === undefined ? {} : { name: text(c.name) }),
      ...(c.visible === undefined ? {} : { visible: boolean(c.visible) }), rest_transform: {
        position_m: c.position_mm === undefined ? [...transform.position_m] : vector(c.position_mm, 3).map(v => v / 1000), rotation_quaternion_xyzw: rotation,
      } } });
  }
  if (type === 'instance-grounded' || type === 'instance-suppressed') {
    const key = type === 'instance-grounded' ? 'grounded' : 'suppressed'; fields(c, ['type','id',key]); capability(assembly.capabilities.can_edit_instances);
    return result(type === 'instance-grounded' ? 'set_instance_grounded' : 'set_instance_suppressed', { instance_id: found(assembly.instances, c.id).id, [key]: boolean(c[key]) });
  }
  if (type === 'mate-update') {
    fields(c,['type','id','name','suppressed']); capability(assembly.capabilities.can_edit_connectors);
    const mate = found(assembly.mates,c.id);
    return result('update_mate',{mate:{...assemblyMateUpdatePayload(mate,{suppressed:c.suppressed === undefined ? mate.suppressed : boolean(c.suppressed)}),name:c.name === undefined ? mate.name : text(c.name)}});
  }
  if (type === 'dof-value' || type === 'dof-limits') {
    fields(c,type === 'dof-value' ? ['type','id','value','unit'] : ['type','id','minimum','maximum','unit']); capability(assembly.capabilities.can_edit_connectors);
    const id = text(c.id), mate = assembly.mates.find(m => m.dofs.some(d => d.id === id));
    if (!mate) throw Error('Mate DOF does not exist.');
    const dof = mate.dofs.find(d => d.id === id)!;
    if (mate.suppressed || dof.state !== 'free') throw Error('Edit an active free DOF; a driven or dependent value is controlled by its relation.');
    const draft = assemblyMateDOFEditorDraft(dof);
    if (c.unit !== (dof.kind === 'rotation' ? 'deg' : 'mm')) throw Error('Use deg for rotational DOFs and mm for translational DOFs.');
    const display = (value: unknown) => finite(value) / (dof.kind === 'translation' ? 1000 : 1);
    if (type === 'dof-value') return result('set_dof_value',{...assemblyMateDOFValuePayload({...draft,value:display(c.value)})});
    const off = c.minimum === null && c.maximum === null;
    return result('update_mate',{mate:assemblyMateDOFLimitsPayload(mate,{...draft,limitsEnabled:!off,minimum:off?null:display(c.minimum),maximum:off?null:display(c.maximum)})});
  }
  if (type === 'connector-add') {
    fields(c,['type','part_id','name','origin_mm','primary_axis','secondary_axis']); capability(assembly.capabilities.can_edit_connectors);
    const part = found(assembly.part_definitions,c.part_id);
    const primary = c.primary_axis ?? 'positive-z', secondary = c.secondary_axis ?? 'positive-x';
    if (![primary,secondary].every(axis => connectorAxisOptions.some(o => o.value === axis))) throw Error('Choose a signed X, Y or Z connector axis.');
    const draft = normalizeAssemblyConnectorDraft({name:text(c.name),provenanceLabel:'Manual Part-local frame',
      originM:vector(c.origin_mm ?? [0,0,0],3).map(v => v / 1000) as [number,number,number],primaryAxis:primary as ConnectorAxisID,secondaryAxis:secondary as ConnectorAxisID});
    return result('add_connector',{connector:{part_definition_id:part.id,name:draft.name,frame_part_local:{origin_m:draft.originM,primary_axis_xyz:draft.primaryAxisXYZ,secondary_axis_xyz:draft.secondaryAxisXYZ},provenance:{kind:'manual',stable_feature_id:null,label:draft.provenanceLabel}}});
  }
  if (type === 'mate-add') {
    fields(c,['type','kind','name','a','b']); capability(assembly.capabilities.can_edit_connectors);
    const kind = assemblyMateTypeOptions.find(option => option.value === c.kind)?.value;
    if (!kind || !assembly.capabilities.supported_mate_type_ids.includes(kind)) throw Error('Unsupported Assembly mate kind.');
    const endpoint = (value: unknown) => {
      const e = object(value); fields(e,['instance_id','connector_id']);
      const instance = found(assembly.instances,e.instance_id), connector = found(assembly.connector_definitions,e.connector_id);
      if (instance.definition_kind !== 'part' || connector.part_definition_id !== instance.definition_id) throw Error('The connector does not belong to that Part instance.');
      return {instanceID:instance.id,connectorDefinitionID:connector.id};
    };
    return result('add_mate',{mate:assemblyMatePayload({name:text(c.name),typeID:kind,endpointA:endpoint(c.a),endpointB:endpoint(c.b)})});
  }
  if (type === 'relation-add' || type === 'relation-update') {
    fields(c,['type','id','kind','driver_dof_id','driven_dof_id','ratio','offset','unit','reversed','suppressed']); capability(assembly.capabilities.can_edit_relations);
    if (!assemblyRelationKindOptions.some(k => k.value === c.kind)) throw Error('Unsupported Assembly relation kind.');
    const previous = type === 'relation-update' ? found(assembly.relations,c.id) : undefined;
    const options = assembly.mates.flatMap(m => m.suppressed ? [] : m.dofs
      .filter(d => d.state === 'free' || (previous && [previous.driver_dof_id,previous.driven_dof_id].includes(d.id)))
      .map(d => ({id:d.id,label:d.name,kind:d.kind})));
    const driven = found(options,c.driven_dof_id);
    if (c.unit !== (driven.kind === 'rotation' ? 'deg' : 'mm')) throw Error('Relation offset units must match the driven DOF.');
    const payload = assemblyRelationPayload({kind:c.kind as AssemblyRelationKind,driverDOFID:text(c.driver_dof_id),drivenDOFID:driven.id,ratio:finite(c.ratio),offset:finite(c.offset)/(driven.kind === 'translation'?1000:1),reversed:c.reversed === undefined ? previous?.reversed ?? false : boolean(c.reversed)},options);
    if (type === 'relation-add' && c.id !== undefined) throw Error('New relation IDs are allocated by the Assembly.');
    const id = previous?.id;
    return result(type === 'relation-add' ? 'add_relation' : 'update_relation',{relation:{...payload,...(id?{id}:{}),suppressed:c.suppressed === undefined ? previous?.suppressed ?? false : boolean(c.suppressed)}});
  }
  if (type === 'contact-add' || type === 'contact-update') {
    fields(c,['type','id','name','instance_ids','suppressed']); capability(assembly.capabilities.can_edit_contacts);
    if (!Array.isArray(c.instance_ids) || c.instance_ids.length < 2 || c.instance_ids.length > 500 || new Set(c.instance_ids).size !== c.instance_ids.length) throw Error('Choose 2–500 distinct contact instances.');
    const ids = c.instance_ids.map(id => found(assembly.instances,id).id);
    if (type === 'contact-add' && c.id !== undefined) throw Error('New contact IDs are allocated by the Assembly.');
    const previous = type === 'contact-update' ? found(assembly.contact_sets ?? [],c.id) : undefined;
    const id = previous?.id;
    return result(type === 'contact-add' ? 'add_contact_set' : 'update_contact_set',{contact_set:{...(id?{id}:{}),name:text(c.name),instance_ids:ids,suppressed:c.suppressed === undefined ? previous?.suppressed ?? false : boolean(c.suppressed)}});
  }
  if (type === 'contacts-enabled') {
    fields(c,['type','enabled']); capability(assembly.capabilities.can_edit_contacts); return result('set_contacts_enabled',{enabled:boolean(c.enabled)});
  }
  if (type === 'remove') {
    fields(c,['type','entity','id']);
    const definitions = {
      instance: ['remove_instance','instance_id',assembly.instances,assembly.capabilities.can_edit_instances],
      mate: ['remove_mate','mate_id',assembly.mates,assembly.capabilities.can_edit_connectors],
      connector: ['remove_connector','connector_id',assembly.connector_definitions,assembly.capabilities.can_edit_connectors],
      relation: ['remove_relation','relation_id',assembly.relations,assembly.capabilities.can_edit_relations],
      contact: ['remove_contact_set','contact_set_id',assembly.contact_sets ?? [],assembly.capabilities.can_edit_contacts],
    } as const;
    const entity = text(c.entity);
    const definition = Object.hasOwn(definitions,entity) ? definitions[entity as keyof typeof definitions] : undefined;
    if (!definition) throw Error('Choose instance, mate, connector, relation or contact.');
    const [method,key,items,canEdit] = definition; capability(canEdit);
    return result(method,{[key]:found(items as readonly {id:string}[],c.id).id});
  }
  throw Error('Unsupported Assembly edit command.');
}
