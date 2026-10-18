/** Viewport render environments: what each looks like, in one place.
 *
 *  These palettes were literals inside `MateViewport.setAppearance`, which
 *  made re-theming the 3D view mean editing a 1900-line class. Resolving a
 *  snapshot is pure arithmetic, so it is done here and the viewport is left
 *  only applying the answer to the scene.
 *
 *  Ported from the native PreviewAppearance (RealityKitViewport): background,
 *  minor/major grid colours, and the CAD Light intensity boost.
 */
import { modelStudioLighting } from '../model-studio-environment';
import type { CADAppearanceSnapshot } from "../cad-appearance-store";
import type { ViewportThemeOverride } from "./suite-viewport-theme";

export type RenderEnvironment = CADAppearanceSnapshot["background"];

export interface PlaneTheme {
  colors: Record<"top" | "front" | "right" | "custom", number>;
  style: { fillOpacity: number; borderOpacity: number; labelColor: string; borderWidthPx: number; sizeMillimeters: number; labelOpacity: number; labelsVisible: boolean };
}

const ENVIRONMENTS = {
  midnight: { background: 0x090d18, gridMinor: 0x949494, gridMajor: 0x4580c7, gridOpacity: 0.3, lightBoost: 1 },
  graphite: { background: 0x26292e, gridMinor: 0xb8b8b8, gridMajor: 0xc7c7c7, gridOpacity: 0.27, lightBoost: 1 },
  "cad-light": { background: 0xc7cfd6, gridMinor: 0x292929, gridMajor: 0x1f1f1f, gridOpacity: 0.4, lightBoost: 16 / 12 },
  blueprint: { background: 0x062945, gridMinor: 0x26a8d1, gridMajor: 0x2ec7f0, gridOpacity: 0.33, lightBoost: 1 },
  onshape: { background: 0xf2f5f7, gridMinor: 0x9aa4ad, gridMajor: 0x7f8a94, gridOpacity: 0.18, lightBoost: 1.28 },
} as const;

/** Sketch curves drawn over the model, per environment. */
const SKETCH_STROKES = {
  midnight: 0xcfe4ff, graphite: 0xdbe4ee, "cad-light": 0x24466e,
  blueprint: 0xaee9ff, onshape: 0x24466e,
} as const;

/** Reference-plane presentation follows the render environment, not the UI
 *  theme: Onshape uses pale translucent fills with blue labels. */
const PLANE_STYLES = {
  onshape: {
    colors: { top: 0x7d9fd9, front: 0x7d9fd9, right: 0x7d9fd9, custom: 0x7d9fd9 },
    style: { fillOpacity: 0.14, borderOpacity: 0.7, labelColor: "#2f5bd7" },
  },
};

export const materialFinishes = {
  matte: { roughness: 0.78, metalness: 0.02 },
  satin: { roughness: 0.56, metalness: 0.05 },
  gloss: { roughness: 0.24, metalness: 0.08 },
} as const;

const LIGHTING = {
  "model-studio": modelStudioLighting,
  studio: { hemisphere: 2.2, key: 3.2, fill: 1.25, rim: 0.65, sky: 0xffffff, ground: 0x6f8291, keyColor: 0xffffff, fillColor: 0xb9dcff, rimColor: 0x91bfff },
  softbox: { hemisphere: 2.75, key: 2.15, fill: 1.95, rim: 0.4, sky: 0xffffff, ground: 0x91a0aa, keyColor: 0xfff7ed, fillColor: 0xd7e9ff, rimColor: 0xc6dfff },
  daylight: { hemisphere: 2.45, key: 4.1, fill: 0.8, rim: 0.3, sky: 0xdcefff, ground: 0x78917b, keyColor: 0xfff2cf, fillColor: 0xb9dcff, rimColor: 0xd8efff },
  "dark-room": { hemisphere: 0.72, key: 2.35, fill: 0.3, rim: 1.25, sky: 0x627d96, ground: 0x111820, keyColor: 0xdce9ff, fillColor: 0x607da5, rimColor: 0x62b6ff },
} as const;

export interface ResolvedAppearance {
  background: number;
  edgeColor: number;
  edgeOpacity: number;
  bodyColor: number;
  bodyOpacity: number;
  gridMinor: number;
  gridMajor: number;
  /** Already scaled by the user's grid opacity percentage. */
  gridOpacity: number;
  sketchStroke: number;
  planeTheme: PlaneTheme;
  grid: { spacing: number; extent: number; majorEvery: number; minorWidth: number; majorWidth: number; axisWidth: number; majorOpacity: number; axisOpacity: number; axisColor: number; xColor: number; yColor: number; zColor: number };
  colorTransform: "standard" | "filmic";
  backgroundMode: "solid" | "gradient";
  backgroundBottom: number;
  edgeWidth: number;
  sketchLineWidth: number;
  sketchGridSpacing: number;
  selectionColor: number;
  hoverColor: number;
  floorColor: number;
  floorOpacity: number;
  floorRoughness: number;
  exposure: number;
  emissiveColor: number;
  emissiveIntensity: number;
  finish: { roughness: number; metalness: number };
  lights: {
    sky: number; ground: number; keyColor: number; fillColor: number; rimColor: number;
    /** Already scaled by the environment percentage and the theme's boost. */
    hemisphere: number; key: number; fill: number; rim: number;
    keyAzimuth: number; keyElevation: number; fillAzimuth: number; fillElevation: number; rimAzimuth: number; rimElevation: number;
  };
}

/** Everything the viewport needs to paint itself for one appearance snapshot.
 *
 *  An unknown environment falls back to graphite rather than throwing: an
 *  appearance arriving from a newer document should restyle the view, not
 *  break it.
 */
export function resolveAppearance(
  appearance: CADAppearanceSnapshot,
  /** A suite viewport theme, when the person has chosen one: it outranks the
   *  render environment for the stage, and leaves lighting and finish alone. */
  viewportTheme?: ViewportThemeOverride | null,
): ResolvedAppearance {
  const environment = ENVIRONMENTS[appearance.background] ?? ENVIRONMENTS.graphite;
  const profile = LIGHTING[appearance.lightingPreset];
  const lightScale = appearance.environmentPercent / 100 * (appearance.colorTransform === "standard" ? appearance.exposure ?? 1 : 1);
  const theme = viewportTheme ?? {};
  const color = (value: string | undefined, fallback: number) => /^#[0-9a-f]{6}$/i.test(value ?? "") ? parseInt(value!.slice(1),16) : fallback;
  const finite = (value: number | undefined, fallback: number) => Number.isFinite(value) ? value! : fallback;
  const opacity = (value: number | undefined, fallback: number) => finite(value, fallback * 100) / 100;
  const gridOpacity = opacity(appearance.gridMinorOpacityPercent, (theme.gridOpacityScale ?? environment.gridOpacity) * ((appearance.gridOpacityPercent ?? 100) / 100));
  const plane = appearance.background === "onshape" ? PLANE_STYLES.onshape : {
    colors: { top: 0x4f8dff, front: 0xef6976, right: 0x4ccf8a, custom: 0x89aaff },
    style: { fillOpacity: appearance.background === "cad-light" ? 0.10 : 0.055, borderOpacity: appearance.background === "cad-light" ? 0.85 : 0.55,
      labelColor: appearance.background === "cad-light" ? "#23445c" : "#a9cfff" },
  };
  const background = color(appearance.backgroundColor, theme.background ?? environment.background);
  return {
    grid: { spacing: finite(appearance.gridSpacingMillimeters, 25), extent: finite(appearance.gridExtentMillimeters, 1600),
      majorEvery: finite(appearance.gridMajorEvery, 5), minorWidth: finite(appearance.gridMinorWidthPx, 1), majorWidth: finite(appearance.gridMajorWidthPx, 1.5), axisWidth: finite(appearance.gridAxisWidthPx, 2),
      majorOpacity: opacity(appearance.gridMajorOpacityPercent, Math.min(1, gridOpacity * 1.8)), axisOpacity: opacity(appearance.gridAxisOpacityPercent, 0.85),
      axisColor: color(appearance.gridAxisColor, theme.gridMajor ?? environment.gridMajor),
      xColor: color(appearance.gridXAxisColor, color(appearance.gridAxisColor, theme.gridMajor ?? environment.gridMajor)),
      yColor: color(appearance.gridYAxisColor, color(appearance.gridAxisColor, theme.gridMajor ?? environment.gridMajor)),
      zColor: color(appearance.gridZAxisColor, color(appearance.gridAxisColor, theme.gridMajor ?? environment.gridMajor)) },
    colorTransform: appearance.colorTransform ?? "filmic",
    backgroundMode: appearance.backgroundMode ?? "solid",
    backgroundBottom: color(appearance.backgroundBottomColor, 0xffffff),
    edgeWidth: finite(appearance.edgeWidthPx, 1), sketchLineWidth: finite(appearance.sketchLineWidthPx, 2.1),
    sketchGridSpacing: finite(appearance.sketchGridSpacingMillimeters, 10),
    selectionColor: color(appearance.selectionColor, 0xffac39), hoverColor: color(appearance.hoverColor, 0x33d0ff),
    floorColor: color(appearance.floorColor, background), floorOpacity: opacity(appearance.floorOpacityPercent, 1), floorRoughness: finite(appearance.floorRoughness, 0.9),
    exposure: finite(appearance.exposure, 1),
    emissiveColor: color(appearance.emissiveColor, 0), emissiveIntensity: finite(appearance.emissiveIntensity, 0),
    background: color(appearance.backgroundColor, theme.background ?? environment.background),
    edgeColor: color(appearance.edgeColor,0x14242d),
    edgeOpacity: Number.isFinite(appearance.edgeOpacityPercent) ? Math.min(100,Math.max(0,appearance.edgeOpacityPercent!))/100 : appearance.displayStyle === "ghost" ? 0.42 : 0.55,
    bodyColor: /^#[0-9a-f]{6}$/i.test(appearance.bodyColor ?? "")
      ? parseInt(appearance.bodyColor!.slice(1), 16) : 0x79a9c2,
    bodyOpacity: Number.isFinite(appearance.bodyOpacityPercent)
      ? Math.min(100, Math.max(0, appearance.bodyOpacityPercent!)) / 100 : 1,
    gridMinor: color(appearance.gridMinorColor,theme.gridMinor ?? environment.gridMinor),
    gridMajor: color(appearance.gridMajorColor,theme.gridMajor ?? environment.gridMajor),
    gridOpacity,
    sketchStroke: color(appearance.sketchStrokeColor, theme.sketchStroke ?? SKETCH_STROKES[appearance.background] ?? SKETCH_STROKES.graphite),
    planeTheme: {
      colors: { top: color(appearance.planeTopColor, plane.colors.top), front: color(appearance.planeFrontColor, plane.colors.front), right: color(appearance.planeRightColor, plane.colors.right), custom: color(appearance.planeCustomColor, plane.colors.custom) },
      style: { fillOpacity: opacity(appearance.planeFillOpacityPercent, plane.style.fillOpacity), borderOpacity: opacity(appearance.planeBorderOpacityPercent, plane.style.borderOpacity),
        labelColor: appearance.planeLabelColor ?? plane.style.labelColor, borderWidthPx: finite(appearance.planeBorderWidthPx, 1), sizeMillimeters: finite(appearance.planeSizeMillimeters, 110),
        labelOpacity: opacity(appearance.planeLabelOpacityPercent, 1), labelsVisible: appearance.planeLabelsVisible ?? true },
    },
    finish: {
      roughness: Number.isFinite(appearance.roughness) ? Math.min(1, Math.max(0, appearance.roughness!)) : materialFinishes[appearance.materialFinish].roughness,
      metalness: Number.isFinite(appearance.metalness) ? Math.min(1, Math.max(0, appearance.metalness!)) : materialFinishes[appearance.materialFinish].metalness,
    },
    lights: {
      keyAzimuth: finite(appearance.keyLightAzimuthDegrees, -123.69), keyElevation: finite(appearance.keyLightElevationDegrees, 47.97),
      fillAzimuth: finite(appearance.fillLightAzimuthDegrees, 18.43), fillElevation: finite(appearance.fillLightElevationDegrees, 25.38),
      rimAzimuth: finite(appearance.rimLightAzimuthDegrees, 68.2), rimElevation: finite(appearance.rimLightElevationDegrees, 36.6),
      sky: color(appearance.ambientSkyColor, profile.sky),
      ground: color(appearance.ambientGroundColor, profile.ground),
      keyColor: color(appearance.keyLightColor, profile.keyColor),
      fillColor: color(appearance.fillLightColor, profile.fillColor),
      rimColor: color(appearance.rimLightColor, profile.rimColor),
      hemisphere: profile.hemisphere * lightScale * opacity(appearance.ambientLightPercent, 1),
      // The rim is deliberately not boosted: the boost exists to lift a light
      // scene's key and fill, and boosting the rim washed out its edge.
      key: profile.key * lightScale * environment.lightBoost * opacity(appearance.keyLightPercent, 1),
      fill: profile.fill * lightScale * environment.lightBoost * opacity(appearance.fillLightPercent, 1),
      rim: profile.rim * lightScale * opacity(appearance.rimLightPercent, 1),
    },
  };
}
