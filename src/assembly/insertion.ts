/** Source insertion reuses the validated assembly recipe command. It does not
 * create a parallel document model or a metadata-only component. */
import { availableBodies, parsePartDocument, type PartDocument } from '../aether-core';
import type { AssemblyProjectionV1 } from '../cad-assembly-bridge';

export type InsertSource =
  | { kind: 'design-part'; workspaceId: string; partId: string }
  | { kind: 'saved-part'; fileId: string; revision: number; partId?: string; branch?: string };
export interface InsertCandidate {
  id: string;
  name: string;
  kind: 'part' | 'assembly';
  source?: InsertSource;
  document?: PartDocument;
  unavailable?: string;
}
export interface InsertPlacement { positionM: readonly [number, number, number]; grounded: boolean }
/** Establish the first active anchor automatically, including after suppression. */
export function needsAssemblyAnchor(projection: AssemblyProjectionV1): boolean {
  return !projection.instances.some(instance => instance.grounded && !instance.suppressed);
}
export function insertionPart(value: unknown): PartDocument {
  if (!value) throw Error('This Part has no local geometry to insert. Create or resolve its solid first.');
  const document = parsePartDocument(JSON.stringify(value));
  if (!availableBodies(document).length) throw Error('This Part has no solid bodies to insert. Create a solid first.');
  return document;
}
export function designInsertCandidates(projection: AssemblyProjectionV1): InsertCandidate[] {
  return [
    ...projection.part_definitions.map(part => {
      const candidate: InsertCandidate = { id: part.id, name: part.name, kind: 'part',
        source: { kind: 'design-part', workspaceId: projection.workspace_id, partId: part.id } };
      try { candidate.document = insertionPart(part.feature_document); }
      catch (error) { candidate.unavailable = error instanceof Error ? error.message : String(error); }
      return candidate;
    }),
    ...projection.assemblies.filter(item => item.id !== projection.assembly_id).map(item => ({
      id: item.id, name: item.name, kind: 'assembly' as const,
      unavailable: 'Nested subassembly insertion is not supported yet. Insert its Parts individually.',
    })),
  ];
}
export function insertionRecipe(projection: AssemblyProjectionV1, source: InsertSource,
  placement: InsertPlacement, saved?: { name: string; document: PartDocument }) {
  if (placement.positionM.length !== 3 || placement.positionM.some(value => !Number.isFinite(value) || Math.abs(value) > 1000)
    || typeof placement.grounded !== 'boolean') throw Error('Choose a finite insertion position within ±1,000 m.');
  let name: string;
  let part: { key: string; part_id: string } | { key: string; name: string; document: PartDocument };
  if (source.kind === 'design-part') {
    if (source.workspaceId !== projection.workspace_id) throw Error('This Part belongs to a different design. Choose it from Other designs.');
    const definition = projection.part_definitions.find(item => item.id === source.partId);
    if (!definition) throw Error('The source Part is no longer in this design.');
    insertionPart(definition.feature_document);
    name = definition.name;
    part = { key: 'source', part_id: definition.id };
  } else {
    if (!saved) throw Error('Read the saved source Part before inserting it.');
    name = saved.name;
    part = { key: 'source', name, document: insertionPart(saved.document) };
  }
  // Occurrences keep a readable unique name even after deletion or renaming.
  const names = new Set(projection.instances.map(instance => instance.name));
  const stem = name.trim().slice(0, 160) || 'Part';
  let index = 1;
  while (names.has(`${stem}:${index}`)) index++;
  return { version: 1, parts: [part], instances: [{ key: `${stem}:${index}`, part: 'source',
    position_mm: placement.positionM.map(value => value * 1000), grounded: placement.grounded || needsAssemblyAnchor(projection) }] };
}
