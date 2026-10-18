/** The suite viewport theme, shaped for CAD's appearance resolver.
 *
 *  The palette itself is read by `@aether/ui`'s `readViewportPalette`, which
 *  every product's 3D view shares. This adapter turns it into the override
 *  `resolveAppearance` takes: the stage outranks CAD's render environment,
 *  while lighting, finish and display style stay CAD's own settings.
 */
import { activeAetherViewportTheme, readViewportPalette } from "@aether/ui";

export interface ViewportThemeOverride {
  background?: number;
  gridMinor?: number;
  gridMajor?: number;
  /** Replaces the environment's own grid opacity. */
  gridOpacityScale?: number;
  sketchStroke?: number;
}

/**
 * The override for the active viewport theme, or null when the person has not
 * chosen one — then CAD's own render environment stands.
 */
export function readViewportThemeOverride(activeID: string | null = activeAetherViewportTheme()): ViewportThemeOverride | null {
  if (!activeID) return null;
  const palette = readViewportPalette();
  const override: ViewportThemeOverride = {};
  if (palette.background) override.background = palette.background.hex;
  if (palette.grid) { override.gridMinor = palette.grid.hex; override.gridOpacityScale = palette.grid.alpha; }
  if (palette.gridAxis) override.gridMajor = palette.gridAxis.hex;
  if (palette.sketch) override.sketchStroke = palette.sketch.hex;
  return Object.keys(override).length ? override : null;
}
