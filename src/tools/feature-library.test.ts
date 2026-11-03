import { expect, it } from 'vitest';
import { cadFeatureDomains, cadFeatureGroups, cadFeatureToolById, expandFeatureTools } from './feature-library';
import { cadFeaturePalette } from '../react/cad-feature-tray';
import { cadCommands } from '../cad-command-registry';

it('keeps the six domains reachable and expands hidden variants into search without duplicate actions', () => {
  expect(cadFeatureDomains.map(domain => domain.label)).toEqual(['Part','Assembly','Sketch','Curve','Solid','Drawing']);
  const context = { commands: cadCommands.snapshot(), partOpen: false, assemblyReady: false };
  const palette = cadFeaturePalette(context, []);
  expect(new Set(palette.map(command => command.id)).size).toBe(palette.length);
  expect(palette.find(command => command.id === 'feature-chamfer')?.category).toBe('Solid');
  expect(palette.find(command => command.id === 'sketch-tangent-arc')?.category).toBe('Curve');
  expect(palette.find(command => command.id === 'show-export')).toBeUndefined();
  for (const domain of cadFeatureDomains) for (const group of cadFeatureGroups(domain.id)) for (const tool of expandFeatureTools(group.tools)) {
    expect(cadFeatureToolById(tool.id)).toBe(tool);
    if (!tool.action) expect(tool.unavailableReason?.length).toBeGreaterThan(20);
  }
});

it('search follows command availability, preserving named gaps', () => {
  const unregister = cadCommands.register('feature-extrude', () => {});
  try {
    for (const enabled of [true, false]) {
      cadCommands.setEnabled('feature-extrude', enabled);
      const context = { commands: cadCommands.snapshot(), partOpen: true, assemblyReady: false };
      const palette = cadFeaturePalette(context, []);
      expect(palette.find(command => command.id === 'feature-extrude')?.disabled).toBe(!enabled);
      expect(palette.find(command => command.id === 'unavailable:assembly-assembly-template')?.disabled).toBe(true);
      expect(palette.find(command => command.id === 'assembly-from-json')?.disabled).toBe(true);
    }
  } finally { cadCommands.setEnabled('feature-extrude', true); unregister(); }
});

it('keeps all fifteen referenced assembly features discoverable without promising missing solvers', () => {
  const tools = cadFeatureGroups('assembly').flatMap(group => expandFeatureTools(group.tools));
  for (const id of ['assembly-part-template','assembly-insert','assembly-assembly-template','assembly-from-json',
    'assembly-ground','assembly-fixed','assembly-revolute','assembly-slider','assembly-concentric','assembly-coincident',
    'assembly-parallel','assembly-mate-ball','assembly-group','assembly-linear-pattern','assembly-circular-pattern'])
    expect(tools.some(tool => tool.id === id), id).toBe(true);
  expect(cadFeatureToolById('assembly-concentric')?.action).toBe('assembly-mate-cylindrical');
  expect(cadFeatureToolById('assembly-width')?.action).toBeUndefined();
  expect(cadFeatureToolById('solid-pipe')?.action).toBe('feature-pipe');
  expect(cadFeatureToolById('solid-box')).toBeUndefined(); // No premade shapes: sketch and build them.
});
