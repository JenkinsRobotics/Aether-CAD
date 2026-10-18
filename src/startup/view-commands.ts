/** Registration for the commands that only change how the model is shown.
 *
 *  Camera views, display style, lighting, background, material finish, ground
 *  and the selection filter. Sixty lines of near-identical `register` calls
 *  that were sitting in the middle of `main.ts`, between document lifecycle
 *  and assembly wiring — none of which they have anything to do with.
 */
import { cadCommands, type CADCommandID } from "../cad-command-registry";
import {
  cadAppearance,
  type CADBackgroundPreset,
  type CADDisplayStyle,
  type CADFloorMode,
  type CADLightingPreset,
  type CADMaterialFinish,
} from "../cad-appearance-store";
import { cadSelection, selectionFilters, type CADSelectionFilter } from "../cad-selection-store";
import type { StandardCameraView } from "../camera-view";

/** What the view commands need from the app to do their work. */
export interface ViewCommandHost {
  setCameraView(view: StandardCameraView): void;
  frameAll(): void;
  setStatus(message: string, tone?: "normal" | "error" | "success"): void;
}

const CAMERA_VIEWS: readonly (readonly [CADCommandID, StandardCameraView])[] = [
  ["view-top", "top"], ["view-bottom", "bottom"], ["view-front", "front"],
  ["view-back", "back"], ["view-right", "right"], ["view-left", "left"],
  ["view-isometric", "isometric"],
];

const DISPLAY_STYLES: readonly (readonly [CADCommandID, CADDisplayStyle])[] = [
  ["display-shaded", "shaded"], ["display-shaded-edges", "shaded-edges"],
  ["display-wireframe", "wireframe"], ["display-hidden-line", "hidden-line"],
  ["display-ghost", "ghost"],
];

const LIGHTING: readonly (readonly [CADCommandID, CADLightingPreset])[] = [
  ["lighting-studio", "studio"], ["lighting-softbox", "softbox"],
  ["lighting-daylight", "daylight"], ["lighting-dark-room", "dark-room"],
];

const BACKGROUNDS: readonly (readonly [CADCommandID, CADBackgroundPreset])[] = [
  ["background-graphite", "graphite"], ["background-midnight", "midnight"],
  ["background-cad-light", "cad-light"], ["background-blueprint", "blueprint"],
];

const FINISHES: readonly (readonly [CADCommandID, CADMaterialFinish])[] = [
  ["finish-matte", "matte"], ["finish-satin", "satin"], ["finish-gloss", "gloss"],
];

const GROUND: readonly (readonly [CADCommandID, CADFloorMode])[] = [
  ["ground-none", "none"], ["ground-grid", "grid"],
  ["ground-floor", "floor"], ["ground-both", "both"],
];

const FILTERS: readonly (readonly [CADCommandID, CADSelectionFilter])[] = [
  ["selection-auto", "auto"], ["selection-component", "component"],
  ["selection-body", "body"], ["selection-face", "face"],
  ["selection-edge", "edge"], ["selection-vertex", "vertex"],
];

export function registerViewCommands(host: ViewCommandHost): void {
  cadCommands.register("fit-view", () => host.frameAll());
  for (const [command, view] of CAMERA_VIEWS)
    cadCommands.register(command, () => host.setCameraView(view));
  for (const [command, style] of DISPLAY_STYLES)
    cadCommands.register(command, () => cadAppearance.dispatch({ type: "set-display-style", style }));
  for (const [command, preset] of LIGHTING)
    cadCommands.register(command, () => cadAppearance.dispatch({ type: "set-lighting-preset", preset }));
  for (const [command, background] of BACKGROUNDS)
    cadCommands.register(command, () => cadAppearance.dispatch({ type: "set-background", background }));
  for (const [command, finish] of FINISHES)
    cadCommands.register(command, () => cadAppearance.dispatch({ type: "set-material-finish", finish }));
  for (const [command, mode] of GROUND)
    cadCommands.register(command, () => cadAppearance.dispatch({ type: "set-floor-mode", mode }));
  for (const [command, filter] of FILTERS)
    cadCommands.register(command, () => {
      cadSelection.dispatch({ type: "set-filter", filter });
      if (filter === "auto") cadSelection.dispatch({type:"set-drag-mode",mode:"directional"});
    });

  cadCommands.register("toggle-contact-shadows", () =>
    cadAppearance.dispatch({
      type: "set-contact-shadows-visible",
      visible: !cadAppearance.snapshot().contactShadowsVisible,
    }));
  cadCommands.register("toggle-feature-edges", () =>
    cadAppearance.dispatch({
      type: "set-edges-visible",
      visible: !cadAppearance.snapshot().edgesVisible,
    }));
  cadCommands.register("reset-appearance", () => cadAppearance.dispatch({ type: "reset" }));
  const modes = ["directional", "window", "crossing", "freeform", "paint"] as const;
  for (const mode of modes) {
    cadCommands.register(`selection-${mode}`, () => {
      cadSelection.dispatch({ type: "set-drag-mode", mode });
      for (const candidate of modes) cadCommands.setActive(`selection-${candidate}`, candidate === mode);
    });
    cadCommands.setActive(`selection-${mode}`, cadSelection.snapshot().dragMode === mode);
  }
  for (const priority of ["body", "face", "edge"] as const) {
    cadCommands.register(`selection-priority-${priority}`, () => {
      cadSelection.dispatch({ type: "set-priority", priority });
      for (const candidate of ["body", "face", "edge"] as const)
        cadCommands.setActive(`selection-priority-${candidate}`, candidate === priority);
    });
    cadCommands.setActive(`selection-priority-${priority}`, cadSelection.snapshot().priority === priority);
  }
  cadCommands.register("selection-clear", () => cadSelection.dispatch({ type: "clear" }));
  cadCommands.register("selection-next-filter", () => {
    const index = selectionFilters.indexOf(cadSelection.snapshot().filter);
    const filter = selectionFilters[(index + 1) % selectionFilters.length];
    cadSelection.dispatch({ type: "set-filter", filter });
    host.setStatus(`Selection filter: ${filter}.`);
  });
}

/** Every command this module owns, so a test can prove none was dropped. */
export const viewCommandIDs: readonly CADCommandID[] = [
  "fit-view",
  ...CAMERA_VIEWS.map(([id]) => id),
  ...DISPLAY_STYLES.map(([id]) => id),
  ...LIGHTING.map(([id]) => id),
  ...BACKGROUNDS.map(([id]) => id),
  ...FINISHES.map(([id]) => id),
  ...GROUND.map(([id]) => id),
  ...FILTERS.map(([id]) => id),
  "toggle-contact-shadows",
  "toggle-feature-edges",
  "reset-appearance",
  "selection-next-filter",
  "selection-directional", "selection-window", "selection-crossing", "selection-clear",
  "selection-freeform", "selection-paint",
  "selection-priority-body", "selection-priority-face", "selection-priority-edge",
];
