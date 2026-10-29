import { expect, it, vi } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';
import type { NumericPartTransform } from '@aether/core/document';
import type { AssemblyProjectionV1 } from '../cad-assembly-bridge';
import { captureAssemblyPlacement, movableOccurrence, placementUpdate } from './placement-manipulator';
const pose = { position_m: [.02, -.04, .1], rotation_quaternion_xyzw: [0, 0, 0, 1] } as const;
const instance = { id: 'moving', name: 'Block:2', definition_id: 'part', definition_kind: 'part', parent_assembly_id: 'assembly',
  parent_instance_id: null, rest_transform: pose, solved_world_transform: pose, grounded: false, visible: true, suppressed: false, source_status: 'resolved' };
const assembly = { revision: '1', workspace_id: 'design', assembly_id: 'assembly', instances: [instance], mates: [],
  capabilities: { can_edit_instances: true }, part_definitions: [{ id: 'part', feature_document: { features: [{ type: 'sketch', id: 'original' }] } }] } as unknown as AssemblyProjectionV1;
const translate: NumericPartTransform = { kind: 'translate', translationMillimeters: [10, 20, -30] };
function fixture() {
  let source: AssemblyProjectionV1 | null = structuredClone(assembly), editable = true, ids = ['moving'];
  const edit = vi.fn(async () => {}), rendered = vi.fn(async () => {});
  const host = { projection: () => source, editable: () => editable, selectedIDs: () => ids,
    bodyIDs: () => ['assembly:moving:body1', 'assembly:other:body1', 'assembly:moving:body2'], edit, rendered };
  return { host, edit, rendered, source: (p: AssemblyProjectionV1 | null) => { source = p; },
    editable: (v: boolean) => { editable = v; }, select: (v: string[]) => { ids = v; } };
}
it('moves a complete occurrence in millimeters without editing its shared definition', () => {
  const before = structuredClone(assembly);
  const update = placementUpdate(assembly, 'moving', translate);
  expect(update.instance.rest_transform.position_m).toEqual([.03, -.02, .07]);
  expect(update.instance).toMatchObject({ id: 'moving', definition_id: 'part', grounded: false });
  expect(assembly).toEqual(before);
  expect(captureAssemblyPlacement(fixture().host)?.ids).toEqual(['assembly:moving:body1', 'assembly:moving:body2']);
});
it('rotates an already oriented occurrence about a world pivot, preserving its local coordinates', () => {
  const initial = new Quaternion().setFromEuler(new Euler(.2, -.4, .7));
  const p = { ...assembly, instances: [{ ...assembly.instances[0], solved_world_transform: { ...pose, rotation_quaternion_xyzw: initial.toArray() } }] } as AssemblyProjectionV1;
  const next = placementUpdate(p, 'moving', { kind: 'rotate', axisOriginMillimeters: [20, -40, 0], axisDirection: [0, 1, 0], angleDegrees: 90 }).instance;
  expect(new Vector3(...next.rest_transform.position_m).distanceTo(new Vector3(.12, -.04, 0))).toBeLessThan(1e-10);
  const expected = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2).multiply(initial);
  expect(Math.abs(expected.dot(new Quaternion(...next.rest_transform.rotation_quaternion_xyzw)))).toBeCloseTo(1, 12);
});
it.each([{ grounded: true }, { suppressed: true }, { visible: false }, { parent_instance_id: 'parent' }, { definition_kind: 'assembly' }])('refuses direct placement for %j', fields => {
  const p = { ...assembly, instances: [{ ...assembly.instances[0], ...fields }] } as AssemblyProjectionV1;
  expect(movableOccurrence(p, 'moving')).toBeNull();
  expect(() => placementUpdate(p, 'moving', translate)).toThrow();
});
it('does not bypass mates or grant Part/read-only/multiple-occurrence movement', () => {
  const f = fixture();
  f.source(null); expect(captureAssemblyPlacement(f.host)).toBeNull();
  f.source(assembly); f.editable(false); expect(captureAssemblyPlacement(f.host)).toBeNull();
  f.editable(true); f.select(['moving', 'other']); expect(captureAssemblyPlacement(f.host)).toBeNull();
  f.select(['moving']); f.source({ ...assembly, capabilities: { ...assembly.capabilities, can_edit_instances: false } });
  expect(captureAssemblyPlacement(f.host)).toBeNull();
  f.source({ ...assembly, mates: [{ suppressed: false, endpoint_a: { instance_id: 'moving' }, endpoint_b: { instance_id: 'base' } }] } as unknown as AssemblyProjectionV1);
  expect(captureAssemblyPlacement(f.host)).toBeNull(); expect(f.edit).not.toHaveBeenCalled();
});
it.each(['revision', 'workspace', 'readonly', 'abort'])('refuses a stale %s before invoking the canonical editor', async reason => {
  const f = fixture(), captured = captureAssemblyPlacement(f.host)!, abort = new AbortController();
  if (reason === 'revision') f.source({ ...assembly, revision: '2' });
  if (reason === 'workspace') f.source({ ...assembly, workspace_id: 'elsewhere' });
  if (reason === 'readonly') f.editable(false);
  if (reason === 'abort') abort.abort();
  await expect(captured.apply(translate, abort.signal)).rejects.toThrow();
  expect(f.edit).not.toHaveBeenCalled();
});
it('uses the captured revision and awaits viewport upload after the atomic edit', async () => {
  const f = fixture(), captured = captureAssemblyPlacement(f.host)!, abort = new AbortController();
  let uploaded!: () => void;
  f.rendered.mockImplementation(() => new Promise(resolve => { uploaded = resolve; }));
  let done = false;
  const operation = captured.apply(translate, abort.signal).then(() => { done = true; });
  await vi.waitFor(() => expect(f.rendered).toHaveBeenCalledOnce());
  expect(f.edit).toHaveBeenCalledWith(placementUpdate(assembly, 'moving', translate), '1', abort.signal, expect.any(Function));
  expect(done).toBe(false); uploaded(); await operation; expect(done).toBe(true);
});
