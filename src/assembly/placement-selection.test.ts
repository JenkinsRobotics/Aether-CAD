import { afterEach, expect, it, vi } from 'vitest';
import type { AssemblyProjectionV1 } from '../cad-assembly-bridge';
import { cadSelection } from '../cad-selection-store';
import { cadAssemblyWorkspace } from '../cad-assembly-workspace-store';
vi.mock('../features/selection-manipulator', () => ({ mountSelectionManipulator: () => () => {} }));
import { mountAssemblyPlacementManipulator } from './placement-manipulator';
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); cadSelection.dispatch({ type: 'clear' }); cadAssemblyWorkspace.setUnavailable(); });
it('synchronizes complete occurrences without treating hover as a new selection', () => {
  cadAssemblyWorkspace.setReady({ treeNodes: [{ id: 'moving' }, { id: 'mate' }], bomRows: [] } as any);
  const assembly = { instances: [{ id: 'moving' }] } as unknown as AssemblyProjectionV1;
  const rows = [{ id: 'assembly:moving:a', name: 'A' }, { id: 'assembly:moving:b', name: 'B' }];
  dispose = mountAssemblyPlacementManipulator({ viewport: {} as HTMLElement,
    viewer: { getPartRows: () => rows } as any, projection: () => assembly, editable: () => true,
    edit: vi.fn(), rendered: async () => {}, status: vi.fn() });
  cadAssemblyWorkspace.dispatch({ type: 'select-entities', ids: ['moving'], mode: 'single' });
  expect(cadSelection.snapshot().items.map(i => i.partId)).toEqual(rows.map(r => r.id));
  cadAssemblyWorkspace.dispatch({ type: 'select-entities', ids: ['mate'], mode: 'single' });
  expect(cadSelection.snapshot().items).toHaveLength(0);
  cadSelection.dispatch({ type: 'set-hovered', item: { id: 'hover', kind: 'body', partId: rows[0].id, label: 'A' } });
  expect([...cadAssemblyWorkspace.snapshot().selectedEntityIDs]).toEqual(['mate']);
  cadSelection.dispatch({ type: 'replace', items: [{ id: 'picked', kind: 'body', partId: rows[1].id, label: 'B' }] });
  expect([...cadAssemblyWorkspace.snapshot().selectedEntityIDs]).toEqual(['moving']);
});
