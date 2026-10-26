import { expect, it, vi } from 'vitest';
import { createEmptyPartDocument } from '@aether/core/document';
import type { AgentTool } from '@aether/ui/AgentServices';
import { cadAgentTools, preparePartEdit } from './live-commands';
import { validateToolArguments } from './tool-arguments';
import { CADAgentEditor, type CADAgentWorkspace } from './live-workspace';
import { assemblyAgentTools } from './assembly-agent';
import { drawingAgentTools } from './drawing-agent';

it.each([
  ['aether_cad_sketch_circle', { plane: 'XY', center_x_mm: 0, center_y_mm: 0 }, /missing required radius_mm/],
  ['aether_cad_sketch_circle', { plane: 'XY', center_x_mm: 0, center_y_mm: 0, radius_mm: '10' }, /radius_mm: must be number/],
  ['aether_cad_sketch_polygon', { plane: 'XY', points_mm: [[0, 0], [1, 0], [0, Infinity]] }, /points_mm\[2\]\[1\]/],
  ['aether_cad_sketch_circle', { frame: { origin_mm: [0, 0], x_direction: [1, 0, 0], y_direction: [0, 1, 0] }, center_x_mm: 0, center_y_mm: 0, radius_mm: 1 }, /frame.origin_mm/],
  ['aether_cad_sketch_circle', { frame: { origin_mm: [0, 0, 0], x_direction: [1, 0, 0], y_direction: [0, 1, 0], units: 'meters' }, center_x_mm: 0, center_y_mm: 0, radius_mm: 1 }, /Unknown argument units/],
  ['aether_cad_verify', { density_kg_m3: 0 }, /greater than 0/],
  ['aether_cad_inspect', { limit: 51 }, /at most 50/],
  ['aether_cad_inspect', { offset: 0.5 }, /must be integer/],
] as const)('refuses malformed %s before any operation', (name, args, message) => {
  expect(() => validateToolArguments(cadAgentTools, name, args)).toThrow(message);
});

it('enforces the published contracts across Part, Assembly and Drawing tools', () => {
  expect(() => validateToolArguments(assemblyAgentTools, 'aether_cad_assembly_inspect', { section: 'unknown' })).toThrow(/section/);
  expect(() => validateToolArguments(assemblyAgentTools, 'aether_cad_assembly_edit', { command_json: '{}' })).toThrow(/expected_revision/);
  expect(() => validateToolArguments(drawingAgentTools, 'aether_cad_drawing_export', { expected_revision: 'r', format: 'svg', all_sheets: 'false' })).toThrow(/all_sheets: must be boolean/);
  expect(() => validateToolArguments(drawingAgentTools, 'aether_cad_drawing_inspect', { offset: -1 })).toThrow(/offset/);
});

it('keeps both JSON text and resolved program objects valid for canonical feature operations', () => {
  const source = createEmptyPartDocument('Program');
  const feature = { type: 'plane', plane: 'XY', offsetMillimeters: 0 };
  for (const feature_json of [feature, JSON.stringify(feature)]) {
    const result = preparePartEdit(source, 'aether_cad_feature_add', { feature_json });
    expect(result.document.features[0]).toMatchObject(feature);
  }
  expect(source.features).toHaveLength(0);
});

it('rejects malformed calls before geometry, verification, or history is touched', async () => {
  const doc = createEmptyPartDocument('Untouched');
  const workspace: CADAgentWorkspace = {
    current: () => doc, contextKey: () => 'part', available: () => true, writable: () => true,
    evaluate: vi.fn(), verify: vi.fn(), commit: vi.fn(), history: { candidate: vi.fn(), commit: vi.fn() },
  };
  await expect(new CADAgentEditor(workspace).execute('part', {
    id: 'call', name: 'aether_cad_verify', arguments: { density_kg_m3: 'steel' },
  }, new AbortController().signal)).rejects.toThrow(/density_kg_m3/);
  for (const action of [workspace.evaluate, workspace.verify, workspace.commit, workspace.history.candidate, workspace.history.commit]) expect(action).not.toHaveBeenCalled();
});

it('fails visibly if a future tool declares a rule the validator cannot enforce', () => {
  const tools: AgentTool[] = [{ name: 'future', description: 'Future', inputSchema: { type: 'object', not: {} } }];
  expect(() => validateToolArguments(tools, 'future', {})).toThrow(/Unsupported CAD contract keyword: not/);
});
