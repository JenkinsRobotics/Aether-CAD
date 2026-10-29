/** Viewport placement belongs to an Assembly occurrence. It never inserts a
 * Transform feature into a Part or changes the occurrence's shared definition. */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { NumericPartTransform } from '@aether/core/document';
import type { AssemblyProjectionV1 } from '../cad-assembly-bridge';
import { mountSelectionManipulator, type PlacementSelection } from '../features/selection-manipulator';
import type { MateViewport } from '../viewer';
import { cadSelection } from '../cad-selection-store';
import { cadAssemblyWorkspace } from '../cad-assembly-workspace-store';
import { transformMatrix } from '../viewport/selection-manipulator-math';
import { instanceDraft, instancePoseControlled, instanceUpdate } from './instance-edit';

export function movableOccurrence(assembly: AssemblyProjectionV1, id: string) {
  const instance = assembly.instances.find(item => item.id === id);
  return instance && assembly.capabilities.can_edit_instances && instance.definition_kind === 'part'
    && !instance.grounded && !instance.suppressed && instance.visible && !instance.parent_instance_id
    && !instancePoseControlled(assembly, instance) ? instance : null;
}
export function placementUpdate(assembly: AssemblyProjectionV1, id: string, transform: NumericPartTransform) {
  const instance = movableOccurrence(assembly, id);
  if (!instance) throw Error('This component is fixed or positioned by its mates. Edit its placement constraints first.');
  if (transform.kind !== 'translate' && transform.kind !== 'rotate') throw Error('Assembly placement supports translation and rotation.');
  const pose = instance.solved_world_transform ?? instance.rest_transform;
  const original = new Matrix4().compose(new Vector3(...pose.position_m).multiplyScalar(1000),
    new Quaternion(...pose.rotation_quaternion_xyzw), new Vector3(1, 1, 1));
  const moved = transformMatrix(transform).multiply(original);
  const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
  moved.decompose(position, rotation, scale);
  const angles = new Euler().setFromQuaternion(rotation, 'XYZ');
  return instanceUpdate(assembly, id, { ...instanceDraft(instance), positionM: position.multiplyScalar(.001).toArray(),
    rotationRad: [angles.x, angles.y, angles.z] });
}
interface PlacementHost {
  projection(): AssemblyProjectionV1 | null;
  editable(): boolean;
  selectedIDs(): readonly string[];
  bodyIDs(): readonly string[];
  edit(params: ReturnType<typeof placementUpdate>, revision: string, signal: AbortSignal, assertCurrent: () => void): Promise<void>;
  rendered(): Promise<void>;
}
export function captureAssemblyPlacement(host: PlacementHost): PlacementSelection | null {
  const assembly = host.projection(), selected = host.selectedIDs();
  if (!assembly || !host.editable() || selected.length !== 1) return null;
  const instance = movableOccurrence(assembly, selected[0]);
  if (!instance) return null;
  const ids = host.bodyIDs().filter(id => id.startsWith(`assembly:${instance.id}:`));
  if (!ids.length) return null;
  const current = () => {
    const live = host.projection();
    return host.editable() && live?.workspace_id === assembly.workspace_id && live.assembly_id === assembly.assembly_id
      && live.revision === assembly.revision && !!movableOccurrence(live, instance.id);
  };
  return {
    key: `${assembly.workspace_id}:${assembly.assembly_id}:${instance.id}`, revision: assembly.revision, ids, current,
    async apply(transform, signal) {
      const assertCurrent = () => {
        signal.throwIfAborted();
        if (!current()) throw Error('The Assembly changed; movement was cancelled.');
      };
      assertCurrent();
      await host.edit(placementUpdate(assembly, instance.id, transform), assembly.revision, signal, assertCurrent);
      await host.rendered();
    },
  };
}

export function mountAssemblyPlacementManipulator(host: Omit<PlacementHost, 'selectedIDs' | 'bodyIDs'> & {
  viewport: HTMLElement; viewer: MateViewport; status(message: string, error?: boolean): void;
}) {
  let syncing = false;
  const tree = cadAssemblyWorkspace.subscribeActions(action => {
    if (syncing || action.type !== 'select-entities' || !host.projection()) return;
    syncing = true;
    try {
      const ids = [...cadAssemblyWorkspace.snapshot().selectedEntityIDs];
      cadSelection.dispatch({ type: 'replace', items: host.viewer.getPartRows()
        .filter(row => ids.some(id => row.id.startsWith(`assembly:${id}:`)))
        .map(row => ({ id: `body:${row.id}`, kind: 'body', partId: row.id, label: row.name })) });
    } finally { syncing = false; }
  });
  let selectedItems = cadSelection.snapshot().items;
  const canvas = cadSelection.subscribe(() => {
    const items = cadSelection.snapshot().items;
    if (items === selectedItems) return;
    selectedItems = items;
    const assembly = host.projection();
    if (syncing || !assembly) return;
    const ids = [...new Set(cadSelection.snapshot().items.filter(item => ['body', 'component'].includes(item.kind))
      .flatMap(item => assembly.instances.filter(instance => item.partId.startsWith(`assembly:${instance.id}:`)).map(instance => instance.id)))];
    if (JSON.stringify(ids) === JSON.stringify([...cadAssemblyWorkspace.snapshot().selectedEntityIDs])) return;
    syncing = true;
    try { cadAssemblyWorkspace.dispatch({ type: 'select-entities', ids, mode: 'range' }); }
    finally { syncing = false; }
  });
  const dispose = mountSelectionManipulator({ ...host,
    capture: () => captureAssemblyPlacement({ ...host,
      selectedIDs: () => [...cadAssemblyWorkspace.snapshot().selectedEntityIDs],
      bodyIDs: () => host.viewer.getPartRows().map(row => row.id),
    }),
  });
  return () => { tree(); canvas(); dispose(); };
}
