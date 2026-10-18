import { createEmptyPartDocument, serializePartDocument } from '@aether/core/document';
/** Product-owned library factory; no editor, kernel or persistence is started. */
export function createDocument(name: string): File {
  const base = name.trim().replace(/\.(acpart|cadpart)$/i, '').trim();
  if (!base) throw new Error('Enter a part name.');
  return new File([serializePartDocument(createEmptyPartDocument(base))], `${base}.acpart`, { type: 'application/json' });
}
