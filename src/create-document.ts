import { createEmptyPartDocument } from '@aether/core/document';
import { aetherCADFileName } from '@aether/core/document/file-types';
import { partGraph, writeAetherCAD } from './document/aethercad-archive';
/** Product-owned library factory; no editor, kernel or persistence is started. */
export function createDocument(name: string): File {
  const fileName = aetherCADFileName(name);
  const document = createEmptyPartDocument(fileName.replace(/\.aethercad$/, ''));
  return new File([writeAetherCAD(partGraph(document))], fileName, { type: 'application/vnd.aether.workspace+zip' });
}
