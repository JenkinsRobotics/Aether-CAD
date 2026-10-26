/** The component dialog, row menu and ribbon share one live-editor adapter. */
import type { AssemblyMutationMethod, AssemblyProjectionV1 } from '../cad-assembly-bridge';
import { instanceUpdate, type InstanceDraft } from './instance-edit';

interface InstanceHost {
  projection(): AssemblyProjectionV1 | null;
  selectedID(): string | null;
  editable(): boolean;
  edit(method: AssemblyMutationMethod, params: Readonly<Record<string, unknown>>, revision: string,
    signal: AbortSignal, assertCurrent: () => void): Promise<void>;
  openPart(id: string): Promise<void>;
}
let host: InstanceHost | null = null;
export function configureInstanceEditing(value: InstanceHost | null) { host = value; }
export function captureInstanceEdit() {
  const current = host, projection = current?.projection(), id = current?.selectedID();
  if (!current || !projection || !id || !current.editable()) throw Error('Select a component in an editable Assembly.');
  const instance = projection.instances.find(item => item.id === id);
  if (!instance) throw Error('Select a component.');
  return { projection, instance, current };
}
export type InstanceEditCapture = ReturnType<typeof captureInstanceEdit>;
export async function saveInstanceEdit(captured: InstanceEditCapture, draft: InstanceDraft, signal: AbortSignal) {
  const { current, projection, instance } = captured;
  const assertCurrent = () => {
    signal.throwIfAborted();
    const live = current.projection();
    if (host !== current || !current.editable() || !live || live.workspace_id !== projection.workspace_id
      || live.assembly_id !== projection.assembly_id || live.revision !== projection.revision)
      throw Error('The Assembly changed. Reopen component properties before applying this edit.');
  };
  assertCurrent();
  await current.edit('update_instance', instanceUpdate(projection, instance.id, draft), projection.revision, signal, assertCurrent);
}
export async function openSelectedComponentPart() {
  const current = host, projection = current?.projection();
  const instance = projection?.instances.find(item => item.id === current?.selectedID());
  if (!current || !projection || !instance || instance.definition_kind !== 'part'
    || !projection.part_definitions.find(part => part.id === instance.definition_id)?.feature_document)
    throw Error('Select a component with an editable source Part.');
  await current.openPart(instance.definition_id);
}
