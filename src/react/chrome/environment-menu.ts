import { useSyncExternalStore } from "react";
import type { MenuItem } from "@aether/ui";
import { cadAppearance, type CADAppearanceSnapshot, type CADDisplayStyle } from "../../cad-appearance-store";
import { requestCADPropertyPanel } from "../../cad-presentation-store";

const styles: readonly [CADDisplayStyle, string][] = [
  ["shaded", "Shaded"], ["shaded-edges", "Shaded with edges"], ["wireframe", "Wireframe"],
  ["hidden-line", "Hidden line"], ["ghost", "Translucent"], ["accessibility", "Accessibility"],
  ["zebra", "Zebra analysis"], ["draft-analysis", "Draft analysis"], ["curvature-map", "Curvature map"],
];

export function environmentMenuItems(appearance: CADAppearanceSnapshot): MenuItem[] {
  return [
    ...styles.map(([id, label], index): MenuItem => ({
      id: `display:${id}`, label, kind: "radio", checked: appearance.displayStyle === id,
      ...(index === 0 ? { heading: "Display" } : index === 6 ? { heading: "Surface analysis", separatorBefore: true } : {}),
    })),
    { id: "grid", label: "Show grid", kind: "checkbox", checked: ["grid", "both"].includes(appearance.floorMode), heading: "Environment", separatorBefore: true },
    { id: "floor", label: "Show floor", kind: "checkbox", checked: ["floor", "both"].includes(appearance.floorMode) },
    { id: "shadows", label: "Contact shadows", kind: "checkbox", checked: appearance.contactShadowsVisible },
    { id: "edges", label: "Show edges", kind: "checkbox", checked: appearance.edgesVisible },
    { id: "rendering", label: "Environment settings…", separatorBefore: true },
  ];
}

export function selectEnvironmentMenuItem(id: string): void {
  const appearance = cadAppearance.snapshot();
  if (id === "rendering") { requestCADPropertyPanel("rendering"); return; }
  const style = styles.find(([style]) => `display:${style}` === id)?.[0];
  if (style) { cadAppearance.dispatch({ type: "set-display-style", style }); return; }
  if (id === "grid" || id === "floor") {
    let grid = ["grid", "both"].includes(appearance.floorMode);
    let floor = ["floor", "both"].includes(appearance.floorMode);
    if (id === "grid") grid = !grid; else floor = !floor;
    cadAppearance.dispatch({ type: "set-floor-mode", mode: grid ? (floor ? "both" : "grid") : (floor ? "floor" : "none") });
    return;
  }
  if (id === "edges") { cadAppearance.dispatch({ type: "set-edges-visible", visible: !appearance.edgesVisible }); return; }
  if (id === "shadows") { cadAppearance.dispatch({ type: "set-contact-shadows-visible", visible: !appearance.contactShadowsVisible }); return; }
}

export function useEnvironmentMenu() {
  const appearance = useSyncExternalStore(cadAppearance.subscribe, cadAppearance.snapshot, cadAppearance.snapshot);
  return { appearance, items: environmentMenuItems(appearance), onSelect: selectEnvironmentMenuItem };
}
