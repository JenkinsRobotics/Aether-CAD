import { documentRequest } from '@aether/session/documents';
import { parseDrawingDocument, serializeDrawingDocument, type DrawingDocument } from '@aether/core/drawing';
import type { Project } from '../host-library';

interface DesignFile { id: string; name: string; revision: number; writable: boolean; data_base64?: string }
/** Transform the immutable inspected archive with CAD's codec, then let Studio
 * perform the normal permission-checked, compare-and-swap document save. */
export async function persistDesignDrawing(file: DesignFile, branch: string | undefined, drawing: DrawingDocument, drawingId?: string) {
  if (!file.writable) throw Error('This design is read-only.');
  const saved = await documentRequest<DesignFile>('cad', 'read_revision', { id: file.id, revision: file.revision, branch });
  const call = async (method: string, params: object, data_base64?: string) => {
    const response = await fetch('/api/cad/assembly', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'workspace', method, params, data_base64 }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw Error(result.error?.message ?? result.error ?? 'Unable to update the design drawing.');
    return result;
  };
  const handle = `drawing-${crypto.randomUUID()}`;
  const opened = await call('load_workspace', { handle }, saved.data_base64);
  const changed = await call(drawingId ? 'save_drawing' : 'add_drawing', {
    handle, expected_revision: opened.archive.revision, drawing_id: drawingId,
    name: drawing.name, document: JSON.parse(serializeDrawingDocument(drawing)),
  }, opened.archive.data_base64);
  const result = await documentRequest<DesignFile>('cad', 'save', { id: file.id, expected_revision: file.revision, branch,
    data_base64: changed.archive.data_base64 });
  const project = changed.result as Project;
  const item = drawingId ? project.drawings?.find(item => item.id === drawingId) : project.drawings?.at(-1);
  if (!item) throw Error('The saved design did not return its drawing. Reopen the design.');
  return { file: result, project, drawing: parseDrawingDocument(JSON.stringify(item.document)), id: item.id };
}
