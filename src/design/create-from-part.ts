import { documentRequest } from '@aether/session/documents';
import { createNativeFile } from '@aether/session/library/create-native-file';
import { driveRequest, type DriveFile } from '@aether/session/library/drive-api';
import { parsePartDocument, type PartDocument } from '@aether/core/document';
import type { Project } from '../host-library';

/** A standalone Part is never silently changed into a container. This explicit
 * command copies its current geometry into a new Hybrid design beside it. */
export async function createDesignFromPart(name: string, source: PartDocument, sourceFileID: string | null) {
  const origin = sourceFileID ? await driveRequest<DriveFile>('details', { id: sourceFileID }) : null;
  const created = await createNativeFile<{ id: string }>('cad', 'project', name,
    origin ? { organization: origin.organization, workspace: origin.workspace, parent: origin.parent } : { scope: 'personal', parent: null }, origin ? 'drive' : 'library');
  const base = await documentRequest<{ revision: number; project: Project }>('cad', 'project_read', { id: created.id });
  const part = base.project.parts[0];
  if (!part) throw Error('The new design has no Part Studio. Open it from Drive to retry.');
  await documentRequest('cad', 'project_edit', { id: created.id, expected_revision: base.revision,
    operation: 'save_part', part_id: part.id, document: { ...parsePartDocument(JSON.stringify(source)), documentId: part.id }, name: source.name });
  return `/cad/index.html?document=${encodeURIComponent(created.id)}&part=${encodeURIComponent(part.id)}`;
}
