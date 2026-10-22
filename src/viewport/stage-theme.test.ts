import { expect, it } from 'vitest';
import { modelStudioEnvironment as look } from '@aether/assets/themes/rendering/model-studio';
import { resolveAppearance, stageFor, stageFromRenderingTheme } from './appearance-themes';
import { defaultCADAppearance } from '../cad-appearance-store';

it('derives the stage from the shared rendering theme data, as the demo applies it', () => {
  expect(stageFromRenderingTheme(look)).toEqual({ fog: { nearCells: 14, farCells: 32 }, floor: 'shadow', gridFitsModel: true, toneMapped: true });
});

it('applies the Model Studio stage by theme name, keeps it for a customized Model Studio look, and plain stages elsewhere', () => {
  expect(stageFor({ environmentTheme: 'model-studio', lightingPreset: 'studio' }).floor).toBe('shadow');
  expect(stageFor({ environmentTheme: 'custom', lightingPreset: 'model-studio' }).fog).not.toBeNull();
  expect(stageFor({ environmentTheme: 'graphite', lightingPreset: 'studio' })).toMatchObject({ fog: null, floor: 'solid', gridFitsModel: false });
});

it('resolves the default appearance to the Model Studio stage with a fading grid', () => {
  const resolved = resolveAppearance(defaultCADAppearance);
  expect(resolved.stage.floor).toBe('shadow');
  expect(resolved.grid.fade).toBeDefined();
  expect(resolved.grid.toneMapped).toBe(true);
});
