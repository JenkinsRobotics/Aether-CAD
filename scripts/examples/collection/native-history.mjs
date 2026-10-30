import assert from 'node:assert/strict';
import { readAssemblyProjection } from './read-assembly-projection.mjs';

/** Check the archive being shipped, not a recipe's feature count or screenshot. */
export function verifyNativeHistory(path, assemblyID) {
  const projection = readAssemblyProjection(path, assemblyID);
  const parts = projection.part_definitions.map(part => {
    const document = part.feature_document;
    assert.ok(document?.features?.length, `${part.name}: missing native modeling history`);
    assert.ok(document.features.some(f => ['profile', 'sketch'].includes(f.type)), `${part.name}: missing authored sketch`);
    assert.ok(document.features.every(f => !['import-step', 'import-cad'].includes(f.type)), `${part.name}: imported geometry cannot qualify as an authored example`);
    return { id: part.id, name: part.name, features: document.features.map(f => ({ id: f.id, type: f.type, name: f.name })) };
  });
  assert.ok(parts.length, 'Example must contain native Parts');
  return { parts, features: parts.reduce((sum, p) => sum + p.features.length, 0), importedFeatures: 0 };
}
