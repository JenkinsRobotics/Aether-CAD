/** Saved-source access never changes the active editor or writes the source. */
import { cadDocumentRequest as documentRequest } from '../document/local-project';
import { isAetherCADFile } from '@aether/core/document/file-types';
import { insertionPart, type InsertCandidate, type InsertSource } from './insertion';
import type { Project } from '../host-library';
export interface SavedInsertFile { id: string; name: string; revision: number; data_base64?: string }
export async function listInsertFiles(): Promise<SavedInsertFile[]> {
  const groups = await Promise.all(['personal', 'workspace'].map(view =>
    documentRequest<{ files: SavedInsertFile[] }>('cad', 'list', { query: '.', view })));
  return [...new Map(groups.flatMap(group => group.files)
    .filter(file => isAetherCADFile(file.name))
    .map(file => [file.id, file])).values()].sort((a, b) => a.name.localeCompare(b.name));
}
export async function savedInsertCandidates(fileId: string, revision: number, branch?: string): Promise<InsertCandidate[]> {
  const file = await documentRequest<SavedInsertFile>('cad', 'read_revision', { id: fileId, revision, branch });
  if (file.revision !== revision) throw Error('The source revision changed. Select the design again.');
  const source = (partId?: string): InsertSource => ({ kind: 'saved-part', fileId, revision, branch, ...(partId ? { partId } : {}) });
  const candidate = (id: string, name: string, value: unknown, partId?: string): InsertCandidate => {
    const result: InsertCandidate = { id, name, kind: 'part', source: source(partId) };
    try { result.document = insertionPart(value); }
    catch (error) { result.unavailable = error instanceof Error ? error.message : String(error); }
    return result;
  };
  if (!isAetherCADFile(file.name)) throw Error('Choose an Aether CAD document.');
  const { project } = await documentRequest<{ project: Project }>('cad', 'project_read', { id: fileId, revision, branch });
  return [
    ...project.parts.map(part => candidate(part.id, part.name, part.document, part.id)),
    ...project.assemblies.map(item => ({ id: item.id, name: item.name, kind: 'assembly' as const,
      unavailable: 'Nested subassembly insertion is not supported yet. Insert its Parts individually.' })),
  ];
}
export async function readInsertSource(source: Extract<InsertSource, { kind: 'saved-part' }>) {
  const candidates = await savedInsertCandidates(source.fileId, source.revision, source.branch);
  const part = candidates.find(item => item.id === (source.partId ?? source.fileId));
  if (!part?.document || part.unavailable) throw Error(part?.unavailable ?? 'The source Part is no longer available.');
  return { name: part.name, document: part.document };
}
