/** View — cameras, display modes, panels and appearance.
 *
 *  This tray is not on the modelling ribbon: the top bar is for modelling, and
 *  these are rendering and layout controls. Each group is a right sidebar
 *  panel instead (`react/panels/view-tools.tsx`). The definitions stay here so
 *  there is still one catalog of every tool.
 */
import { projectProducer, tool, type CADRibbonWorkspaceDefinition } from "./shared";

export const viewWorkspace: CADRibbonWorkspaceDefinition = {
  id: "view",
  label: "View",
  groups: [
    { id: "view-orientation", icon: "part", label: "Orientation", tools: [
      tool("view-fit", "Fit Model", "fit", "fit-view"),
      tool("view-top", "Top", "view-top", "view-top"),
      tool("view-bottom", "Bottom", "view-top", "view-bottom"),
      tool("view-front", "Front", "view-front", "view-front"),
      tool("view-back", "Back", "view-front", "view-back"),
      tool("view-right", "Right", "view-right", "view-right"),
      tool("view-left", "Left", "view-right", "view-left"),
      tool("view-iso", "Isometric", "part", "view-isometric"),
      tool("view-save", "Save View", "save", undefined, projectProducer),
    ] },
    { id: "view-display", icon: "eye", label: "Display", tools: [
      tool("view-appearance", "Appearance", "material", "show-visualization"),
      tool("view-shaded", "Shaded + Edges", "part", "display-shaded-edges"),
      tool("view-shaded-only", "Shaded", "part", "display-shaded"),
      tool("view-wireframe", "Wireframe", "wireframe", "display-wireframe"),
      tool("view-hidden-line", "Hidden Line", "wireframe", "display-hidden-line"),
      tool("view-ghost", "Ghost", "eye", "display-ghost"),
    ] },
    { id: "view-scene", icon: "light", label: "Scene", tools: [
      tool("view-studio", "Studio", "light", "lighting-studio"),
      tool("view-softbox", "Softbox", "light", "lighting-softbox"),
      tool("view-daylight", "Daylight", "light", "lighting-daylight"),
      tool("view-dark-room", "Dark Room", "light", "lighting-dark-room"),
      tool("view-shadows", "Contact Shadows", "plane", "toggle-contact-shadows"),
    ] },
    { id: "view-material", icon: "material", label: "Material", tools: [
      tool("view-background-graphite", "Graphite", "material", "background-graphite"),
      tool("view-background-midnight", "Midnight", "material", "background-midnight"),
      tool("view-background-cad-light", "CAD Light", "material", "background-cad-light"),
      tool("view-background-blueprint", "Blueprint", "material", "background-blueprint"),
      tool("view-finish-matte", "Matte", "material", "finish-matte"),
      tool("view-finish-satin", "Satin", "material", "finish-satin"),
      tool("view-finish-gloss", "Gloss", "material", "finish-gloss"),
      tool("view-feature-edges", "Feature Edges", "edge", "toggle-feature-edges"),
    ] },
    { id: "view-ground", icon: "grid", label: "Ground", tools: [
      tool("view-ground-none", "None", "remove", "ground-none"),
      tool("view-ground-grid", "Grid", "grid", "ground-grid"),
      tool("view-ground-floor", "Floor", "plane", "ground-floor"),
      tool("view-ground-both", "Grid + Floor", "grid", "ground-both"),
      tool("view-reset-appearance", "Reset", "history", "reset-appearance"),
    ] },
    { id: "view-panels", icon: "panels", label: "Panels", tools: [
      tool("view-items", "Items", "list", "show-items"),
      tool("view-properties", "Properties", "properties", "show-parameters"),
      tool("view-mates", "Assembly", "assembly", "show-mates"),
      tool("view-inspect", "Inspect", "inspect", "show-inspect"),
      tool("view-history", "History", "history", "show-history"),
      tool("view-reset-panels", "Reset Panels", "panels", "reset-panels"),
    ] },
  ],
};
