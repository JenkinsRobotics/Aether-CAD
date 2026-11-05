import assert from 'node:assert/strict';
import { readAssemblyProjection } from './read-assembly-projection.mjs';

/** Check the archive being shipped, not a recipe's feature count or screenshot. */
export function verifyNativeHistory(path, assemblyID) {
  const projection = readAssemblyProjection(path, assemblyID);
  const parts = projection.part_definitions.map(part => {
    const document = part.feature_document;
    assert.ok(document?.features?.length, `${part.name}: missing native modeling history`);
    assert.ok(document.features.some(f => ['profile', 'sketch'].includes(f.type)), `${part.name}: missing authored sketch`);
    assert.ok(document.features.every(f => !f.type.startsWith('import')), `${part.name}: imported geometry cannot qualify as an authored example`);
    const sketches = document.features.filter(f => ['profile', 'sketch'].includes(f.type));
    return { id: part.id, name: part.name, sketches: sketches.length, fixedContourSketches: sketches.filter(f => f.profile.constraints?.some(c => c.fixedGeometry)).length, drivingDimensions: sketches.reduce((n, f) => n + (f.profile.constraints ?? []).filter(c => ['diameter', 'radius', 'length', 'distance', 'angle'].includes(c.kind) && !c.reference).length, 0), features: document.features.map(f => ({ id: f.id, type: f.type, name: f.name })) };
  });
  assert.ok(parts.length, 'Example must contain native Parts');
  const featureTypes = {};
  for (const p of parts) for (const f of p.features) featureTypes[f.type] = (featureTypes[f.type] ?? 0) + 1;
  return { parts, featureTypes, features: parts.reduce((sum, p) => sum + p.features.length, 0), importedFeatures: 0 };
}
