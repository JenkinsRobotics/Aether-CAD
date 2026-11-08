import { localDocumentRequest, type LocalDocument } from '@aether/session/local-documents';
import { DocumentError, documentRequest } from '@aether/session/documents';
import { isLocalDocument } from '@aether/session/home/runtime';

export function cadDocumentRequest<T>(app: string, action: string, data: Record<string, unknown> = {}): Promise<T> {
  if (app === 'cad' && isLocalDocument() && (action === 'project_read' || action === 'project_edit')) {
    return localProjectRequest<T>(action, data);
  }
  return documentRequest<T>(app, action, data);
}

/** Product-owned container semantics; storage keeps its normal conflict guard. */
export async function localProjectOperation(operation: 'create' | 'read' | 'edit', data: Record<string, unknown>) {
  const response = await fetch(`/api/cad/project-${operation}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new DocumentError(result.error || 'The local CAD operation failed.', response.status);
  return result as { project: unknown; data_base64?: string };
}

export async function localProjectRequest<T>(action: string, data: Record<string, unknown>): Promise<T> {
  const file = await localDocumentRequest<LocalDocument>('cad', 'read', { id: data.id });
  const expected = action === 'project_edit' ? data.expected_revision : data.revision;
  if (expected !== undefined && file.revision !== expected) throw new DocumentError('This file changed. Reopen it before editing.', 409);
  const result = await localProjectOperation(action === 'project_edit' ? 'edit' : 'read', { ...data, data_base64: file.data_base64 });
  if (action === 'project_read') return { ...file, project: result.project } as T;
  if (!result.data_base64) throw new Error('The CAD operation returned no document. Nothing was saved.');
  const saved = await localDocumentRequest<LocalDocument>('cad', 'save', {
    id: file.id, expected_revision: file.revision, data_base64: result.data_base64,
  });
  return { ...saved, project: result.project } as T;
}
