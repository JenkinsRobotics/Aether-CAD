import { modelStudioEnvironment } from './model-studio-environment';
import { modelingEnvironmentStyles } from './cad-environment-styles';
import { advancedValue, cleanAdvancedAppearance, validColor, type CADAdvancedAppearance, type AdvancedAppearanceKey } from "./cad-advanced-appearance";
/* The native RealityKitViewport PreviewAppearance themes, ported exactly. */
export type CADBackgroundPreset = "midnight" | "graphite" | "cad-light" | "blueprint" | "onshape";
export type CADMaterialFinish = "matte" | "satin" | "gloss";
export type CADDisplayStyle = "shaded" | "shaded-edges" | "wireframe" | "hidden-line" | "ghost";
export type CADLightingPreset = "studio" | "softbox" | "daylight" | "dark-room" | "model-studio";
export type CADFloorMode = "none" | "grid" | "floor" | "both";

export type CADBuiltinEnvironment = CADBackgroundPreset | "aether" | "high-contrast" | "fusion360" | "blender" | "model-studio";
export type CADEnvironmentTheme = CADBuiltinEnvironment | "custom";

export interface CADAppearanceSnapshot extends CADAdvancedAppearance {
  activePresetId?: string;
  backgroundColor?: string;
  gridMinorColor?: string;
  gridMajorColor?: string;
  edgeColor?: string;
  edgeOpacityPercent?: number;
  environmentTheme: CADEnvironmentTheme;
  gridOpacityPercent: number;
  background: CADBackgroundPreset;
  displayStyle: CADDisplayStyle;
  lightingPreset: CADLightingPreset;
  floorMode: CADFloorMode;
  contactShadowsVisible: boolean;
  edgesVisible: boolean;
  materialFinish: CADMaterialFinish;
  roughness?: number;
  metalness?: number;
  bodyColor?: string;
  bodyOpacityPercent?: number;
  environmentPercent: number;
}

export type CADAppearanceAction =
  | { type: "set-advanced"; key: AdvancedAppearanceKey; value: string | number | boolean }
  | { type: "apply-saved-preset"; id: string; appearance: CADAppearanceSnapshot }
  | { type: "set-render-color"; target: "backgroundColor" | "gridMinorColor" | "gridMajorColor" | "edgeColor"; color: string }
  | { type: "set-edge-opacity"; percent: number }
  | { type: "reset-render-overrides" }
  | { type: "set-roughness"; value: number }
  | { type: "set-metalness"; value: number }
  | { type: "set-body-color"; color: string }
  | { type: "set-body-opacity"; percent: number }
  | { type: "set-background"; background: CADBackgroundPreset }
  | { type: "set-display-style"; style: CADDisplayStyle }
  | { type: "set-lighting-preset"; preset: CADLightingPreset }
  | { type: "set-floor-mode"; mode: CADFloorMode }
  | { type: "set-contact-shadows-visible"; visible: boolean }
  | { type: "set-edges-visible"; visible: boolean }
  | { type: "set-material-finish"; finish: CADMaterialFinish }
  | { type: "set-environment-percent"; percent: number }
  | { type: "set-grid-opacity-percent"; percent: number }
  | { type: "apply-environment-theme"; theme: CADBuiltinEnvironment }
  | { type: "reset" };

export const defaultCADAppearance: CADAppearanceSnapshot = Object.freeze({
  // Onshape is the shipped default environment (Jonathan, 2026-09-11).
  environmentTheme: "onshape" as CADEnvironmentTheme,
  gridOpacityPercent: 100,
  background: "onshape",
  displayStyle: "shaded-edges",
  lightingPreset: "daylight",
  floorMode: "none",
  contactShadowsVisible: false,
  edgesVisible: true,
  materialFinish: "satin",
  bodyColor: "#79a9c2",
  bodyOpacityPercent: 100,
  environmentPercent: 100,
});

/** The Aether environment bundle (the previous default look). */
export const aetherEnvironmentBundle = Object.freeze({
  environmentTheme: "aether" as CADEnvironmentTheme,
  gridOpacityPercent: 100,
  background: "graphite" as const,
  displayStyle: "shaded-edges" as const,
  lightingPreset: "studio" as const,
  floorMode: "grid" as const,
  contactShadowsVisible: true,
  edgesVisible: true,
  materialFinish: "satin" as const,
  environmentPercent: 100,
});

function reduceAppearance(
  current: CADAppearanceSnapshot,
  action: CADAppearanceAction,
): CADAppearanceSnapshot {
  // Named environment bundles; any manual change marks the theme "custom".
  if (action.type === "apply-environment-theme") {
    const theme = action.theme;
    if (theme === "model-studio") return { ...defaultCADAppearance, ...modelStudioEnvironment };
    if (theme === "aether") return { ...defaultCADAppearance, ...aetherEnvironmentBundle, bodyColor: "#79a9c2" };
    if (theme === "onshape") return { ...defaultCADAppearance, ...modelingEnvironmentStyles.onshape };
    if (theme === "fusion360" || theme === "blender") return { ...defaultCADAppearance, ...modelingEnvironmentStyles[theme], environmentTheme: theme };
    return { ...defaultCADAppearance, environmentTheme: theme,
      background: theme === "high-contrast" ? "cad-light" : theme,
      lightingPreset: "studio", floorMode: "grid", contactShadowsVisible: false,
      ...(theme === "high-contrast" ? { gridMinorOpacityPercent: 65, gridMajorOpacityPercent: 90, gridAxisOpacityPercent: 100,
        gridMinorColor: "#586775", gridMajorColor: "#293c4a", gridAxisColor: "#233746", planeFillOpacityPercent: 15,
        planeBorderOpacityPercent: 95, planeBorderWidthPx: 2, backgroundColor: "#e9edf0" } : {}),
    };
  }
  if (action.type === "set-grid-opacity-percent")
    return !Number.isFinite(action.percent) ? current : {
      ...current,
      environmentTheme: "custom",
      gridOpacityPercent: Math.min(100, Math.max(0, Math.round(action.percent))),
    };
  switch (action.type) {
    case "set-advanced": {
      const value = advancedValue(action.key, action.value);
      return value === undefined ? current : { ...current, [action.key]: value };
    }
    case "apply-saved-preset":
      return { ...normalizeCADAppearance(action.appearance), environmentTheme: "custom", activePresetId: action.id };

    case "set-render-color":
      return /^#[0-9a-f]{6}$/i.test(action.color) ? {...current, environmentTheme:"custom", [action.target]:action.color.toLowerCase()} : current;
    case "set-edge-opacity":
      return Number.isFinite(action.percent) ? {...current,edgeOpacityPercent:Math.min(100,Math.max(0,action.percent))} : current;
    case "reset-render-overrides":
      return {...current,backgroundColor:undefined,gridMinorColor:undefined,gridMajorColor:undefined,edgeColor:undefined,edgeOpacityPercent:undefined};
    case "set-roughness":
    case "set-metalness":
      return Number.isFinite(action.value)
        ? { ...current, [action.type === "set-roughness" ? "roughness" : "metalness"]: Math.min(1, Math.max(0, action.value)) } : current;
    case "set-body-color":
      return /^#[0-9a-f]{6}$/i.test(action.color)
        ? { ...current, bodyColor: action.color.toLowerCase() } : current;
    case "set-body-opacity":
      return Number.isFinite(action.percent)
        ? { ...current, bodyOpacityPercent: Math.min(100, Math.max(0, action.percent)) } : current;
    case "set-background":
      return { ...current, environmentTheme: "custom", background: action.background, backgroundColor: undefined, backgroundBottomColor: undefined, backgroundMode: 'solid' };
    case "set-display-style":
      return { ...current, environmentTheme: "custom", displayStyle: action.style };
    case "set-lighting-preset":
      return { ...current, environmentTheme: "custom", lightingPreset: action.preset };
    case "set-floor-mode":
      return { ...current, environmentTheme: "custom", floorMode: action.mode };
    case "set-contact-shadows-visible":
      return { ...current, environmentTheme: "custom", contactShadowsVisible: action.visible };
    case "set-edges-visible":
      return { ...current, environmentTheme: "custom", edgesVisible: action.visible };
    case "set-material-finish":
      return { ...current, environmentTheme: "custom", materialFinish: action.finish, roughness: undefined, metalness: undefined };
    case "set-environment-percent":
      return {
        ...current,
        environmentTheme: "custom",
        environmentPercent: Number.isFinite(action.percent) ? Math.min(200, Math.max(0, action.percent)) : current.environmentPercent,
      };
    case "reset":
      return defaultCADAppearance;
  }
}

export function reduceCADAppearance(current: CADAppearanceSnapshot, action: CADAppearanceAction): CADAppearanceSnapshot {
  const next = reduceAppearance(current, action);
  if (next === current || action.type === "reset" || action.type === "apply-environment-theme" || action.type === "apply-saved-preset") return next;
  return { ...next, environmentTheme: "custom" };
}

/** Treat browser settings/preset JSON as untrusted input, not an object spread. */
export function normalizeCADAppearance(input: unknown): CADAppearanceSnapshot {
  const v = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const out = { ...defaultCADAppearance, ...cleanAdvancedAppearance(v) };
  const enums = {
    background: ["midnight", "graphite", "cad-light", "blueprint", "onshape"],
    environmentTheme: ["aether", "onshape", "custom", "cad-light", "graphite", "midnight", "blueprint", "high-contrast", "fusion360", "blender", "model-studio"],
    displayStyle: ["shaded", "shaded-edges", "wireframe", "hidden-line", "ghost"],
    lightingPreset: ["studio", "softbox", "daylight", "dark-room", "model-studio"], floorMode: ["none", "grid", "floor", "both"], materialFinish: ["matte", "satin", "gloss"],
  };
  const target = out as unknown as Record<string, unknown>;
  for (const [key, choices] of Object.entries(enums)) if (choices.includes(String(v[key]))) target[key] = v[key];
  for (const key of ["backgroundColor", "gridMinorColor", "gridMajorColor", "edgeColor", "bodyColor"]) if (validColor(v[key])) target[key] = v[key].toLowerCase();
  for (const key of ["contactShadowsVisible", "edgesVisible"]) if (typeof v[key] === "boolean") target[key] = v[key];
  for (const [key, max] of Object.entries({ gridOpacityPercent: 100, edgeOpacityPercent: 100, bodyOpacityPercent: 100, environmentPercent: 200, roughness: 1, metalness: 1 })) {
    const value = v[key]; if (typeof value === "number" && Number.isFinite(value)) target[key] = Number(Math.min(max, Math.max(0, value)).toFixed(6));
  }
  if (typeof v.activePresetId === "string" && v.activePresetId.length <= 100) out.activePresetId = v.activePresetId;
  return out;
}

type Listener = () => void;
type ApplyHandler = (snapshot: CADAppearanceSnapshot) => void;

export class CADAppearanceStore {
  private current: CADAppearanceSnapshot;
  private listeners = new Set<Listener>();
  private applyHandler: ApplyHandler | null = null;

  constructor(initial: CADAppearanceSnapshot = defaultCADAppearance) {
    this.current = initial;
  }

  snapshot = (): CADAppearanceSnapshot => this.current;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  registerApplyHandler(handler: ApplyHandler): () => void {
    this.applyHandler = handler;
    handler(this.current);
    return () => {
      if (this.applyHandler === handler) this.applyHandler = null;
    };
  }

  dispatch(action: CADAppearanceAction): void {
    this.current = Object.freeze(reduceCADAppearance(this.current, action));
    this.applyHandler?.(this.current);
    this.listeners.forEach((listener) => listener());
  }
}

/* Viewport rendering appearance is an Aether CAD app setting (CAD owns the
 * WebGPU/OCCT viewport) — persisted per device, distinct from the universal
 * suite themes in core/assets/themes. */
const CAD_APPEARANCE_KEY = "aether-cad-appearance";
function restoreCADAppearance(): CADAppearanceSnapshot {
  try {
    const raw = localStorage.getItem(CAD_APPEARANCE_KEY);
    if (!raw) return defaultCADAppearance;
    return normalizeCADAppearance(JSON.parse(raw));
  } catch {
    return defaultCADAppearance;
  }
}
export const cadAppearance = new CADAppearanceStore(restoreCADAppearance());
if (typeof localStorage !== "undefined") {
  cadAppearance.subscribe(() => {
    try { localStorage.setItem(CAD_APPEARANCE_KEY, JSON.stringify(cadAppearance.snapshot())); } catch { /* device preference only */ }
  });
}
