import type { ResolvedAppearance } from './appearance-themes';

/** Session presentation only; these overrides never alter CAD material/density. */
export interface PartDisplayOverride {
  color?: string;
  emissiveColor?: string;
  emissiveIntensity?: number;
  opacity?: number;
  roughness?: number;
  metalness?: number;
  edgeColor?: string;
  edgeOpacity?: number;
  edgeWidthPx?: number;
  edgesVisible?: boolean;
}
export function resolvePartDisplay(base: ResolvedAppearance, override: PartDisplayOverride = {}): ResolvedAppearance {
  return { ...base,
    bodyColor: override.color ? Number.parseInt(override.color.slice(1), 16) : base.bodyColor,
    emissiveColor: override.emissiveColor ? Number.parseInt(override.emissiveColor.slice(1),16) : base.emissiveColor,
    emissiveIntensity: override.emissiveIntensity ?? base.emissiveIntensity,
    bodyOpacity: override.opacity ?? base.bodyOpacity,
    edgeColor: override.edgeColor ? Number.parseInt(override.edgeColor.slice(1), 16) : base.edgeColor,
    edgeOpacity: override.edgeOpacity ?? base.edgeOpacity, edgeWidth: override.edgeWidthPx ?? base.edgeWidth,
    finish: { roughness: override.roughness ?? base.finish.roughness, metalness: override.metalness ?? base.finish.metalness },
  };
}
