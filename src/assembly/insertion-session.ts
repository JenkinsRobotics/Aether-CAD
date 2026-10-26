/** Thin live-editor adapter shared by the picker and Files drag/drop. */
import type { AssemblyProjectionV1 } from '../cad-assembly-bridge';
import { designInsertCandidates, insertionRecipe, needsAssemblyAnchor, type InsertPlacement, type InsertSource } from './insertion';
import { readInsertSource } from './insertion-sources';
interface InsertionHost {
  projection(): AssemblyProjectionV1 | null;
  editable(): boolean;
  insert(recipe: unknown, signal: AbortSignal, assertCurrent: () => void): Promise<unknown>;
}
let host: InsertionHost | null = null;
export function configureAssemblyInsertion(value: InsertionHost | null) { host = value; }
export function currentInsertCandidates() {
  const projection = host?.projection();
  return projection ? designInsertCandidates(projection) : [];
}
export function assemblyInsertionAvailable() { return Boolean(host?.editable() && host.projection()); }
export function insertionNeedsAnchor() { const projection = host?.projection(); return !!projection && needsAssemblyAnchor(projection); }
export async function insertAssemblySource(source: InsertSource, placement: InsertPlacement,
  signal = new AbortController().signal) {
  const current = host;
  const projection = current?.projection();
  if (!current || !projection || !current.editable()) throw Error('Open an editable Assembly before inserting a Part.');
  const assertCurrent = () => {
    signal.throwIfAborted();
    if (host !== current || !current.editable() || current.projection() !== projection)
      throw Error('The Assembly changed while selecting the source. No Part was inserted. Try again.');
  };
  assertCurrent();
  const saved = source.kind === 'saved-part' ? await readInsertSource(source) : undefined;
  assertCurrent();
  await current.insert(insertionRecipe(projection, source, placement, saved), signal, assertCurrent);
}
export const ASSEMBLY_PART_MIME = 'application/x-aether-cad-insert-part';
export function parseInsertDrag(value: string): InsertSource {
  if (value.length > 4096) throw Error('Invalid Part drag data.');
  const data = JSON.parse(value);
  const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 256;
  if (data?.kind === 'design-part' && id(data.workspaceId) && id(data.partId))
    return { kind: data.kind, workspaceId: data.workspaceId, partId: data.partId };
  if (data?.kind === 'saved-part' && id(data.fileId) && Number.isSafeInteger(data.revision) && data.revision > 0
    && (data.partId === undefined || id(data.partId)) && (data.branch === undefined || id(data.branch)))
    return { kind: data.kind, fileId: data.fileId, revision: data.revision, partId: data.partId, branch: data.branch };
  throw Error('Drag a Part from this design or choose a saved Part using Insert.');
}
export function installAssemblyInsertionDrop(element: HTMLElement, onError: (error: unknown) => void) {
  const accepts = (event: DragEvent) => event.dataTransfer?.types.includes(ASSEMBLY_PART_MIME) && assemblyInsertionAvailable();
  const over = (event: DragEvent) => { if (accepts(event)) { event.preventDefault(); event.dataTransfer!.dropEffect = 'copy'; } };
  const drop = (event: DragEvent) => {
    if (!accepts(event)) return;
    event.preventDefault(); event.stopPropagation();
    try { void insertAssemblySource(parseInsertDrag(event.dataTransfer!.getData(ASSEMBLY_PART_MIME)),
      { positionM: [0, 0, 0], grounded: false }).catch(onError); }
    catch (error) { onError(error); }
  };
  element.addEventListener('dragover', over); element.addEventListener('drop', drop);
  return () => { element.removeEventListener('dragover', over); element.removeEventListener('drop', drop); };
}
