import { describe, expect, it } from 'vitest';
import { createRectanglePartDocument } from '../aether-core';
import type { AssemblyProjectionV1 } from '../cad-assembly-bridge';
import { assemblySourceFeatures, sourceFeatureTarget } from './source-features';
import { buildCADWorkspaceProjection } from '../cad-workspace-projection';
import { cadHistoryCount } from '../react/panels/feature-tree-commands';

const document = createRectanglePartDocument('Panel', { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 2 });
const assembly = {
  part_definitions: [{ id: 'panel', name: 'Solar panel', feature_document: document },
    { id: 'unused', name: 'Unused', feature_document: document }],
  instances: [{ definition_kind: 'part', definition_id: 'panel' }, { definition_kind: 'part', definition_id: 'panel' }],
} as unknown as AssemblyProjectionV1;
describe('native assembly source features', () => {
  it('shows original sketches/features once per definition, not invented imports or occurrences', () => {
    const view = assemblySourceFeatures(assembly, new Set());
    expect(view.nodes).toHaveLength(1);
    expect(view.nodes[0].children?.map(n => n.label)).toEqual(['Sketch 1', 'Extrude 1']);
    expect(view.history.map(n => n.label)).toEqual(['Sketch 1', 'Extrude 1']);
    expect(view.history.every(n => n.group === 'Solar panel')).toBe(true);
    expect(cadHistoryCount(view.nodes)).toBe(2);
    expect(view.expanded.has('source-part/panel')).toBe(true);
    expect(assemblySourceFeatures(assembly, new Set(['source-part/panel'])).expanded.size).toBe(0);
    expect(sourceFeatureTarget(view.history[0].id)).toEqual({ partID: 'panel', featureID: document.features[0].id });
  });
  it('replaces the legacy imported group for native definitions and retains real external imports', () => {
    const row = { id: 'occurrence', name: 'Panel', sourceDocumentId: document.documentId, sourceName: document.name, constrained: false, visible: true, selected: false };
    const view = buildCADWorkspaceProjection(null, [row, { ...row, id: 'external', sourceDocumentId: 'STEP', sourceName: 'hardware.step' }], new Set(),
      { origin: false, axes: false, 'top-plane': false, 'front-plane': false, 'right-plane': false }, null, [], [], null, { faceCount: 12, candidateCount: 0 },
      new Set(), new Set(), new Set(), null, assembly);
    expect(view.itemNodes.map(n => n.label)).toEqual(['Reference Geometry', 'Solar panel', 'hardware.step']);
    expect(view.historyItems.map(n => n.label)).toEqual(['Sketch 1', 'Extrude 1', 'Import hardware.step']);
  });
  it('retains suppressed and rolled-back source features, and never changes source documents', () => {
    const source = { ...document, rollbackIndex: 1, features: document.features.map((f, i) => ({ ...f, suppressed: i === 0 })) };
    const input = { ...assembly, part_definitions: [{ ...assembly.part_definitions[0], feature_document: source }] };
    const before = JSON.stringify(input);
    expect(assemblySourceFeatures(input, new Set()).history.map(n => n.description)).toEqual(['Suppressed', 'Rolled back']);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('roundtrips scoped IDs without mistaking actual Part history for navigation', () => {
    expect(sourceFeatureTarget('history/source-feature/a%2Fb/c%2Fd')).toEqual({ partID: 'a/b', featureID: 'c/d' });
    expect(sourceFeatureTarget('history/feature/real-id')).toBeNull();
    expect(sourceFeatureTarget('source-part/%oops')).toBeNull();
  });
});
