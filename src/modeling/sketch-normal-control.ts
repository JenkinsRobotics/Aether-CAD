import type { FeatureWindow } from "../features/shared";

/** Explicit camera action; opening a sketch preserves the operator's view. */
export function addSketchNormalControl(win: FeatureWindow): void {
  // A pie/quadrant icon similar to Onshape's normal view icon
  const normalIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M3 12h18"/><path d="M12 3a9 9 0 0 1 9 9h-9V3z" fill="currentColor" fill-opacity="0.3"/></svg>`;
  win.actionIcon(normalIcon, "View normal to sketch plane", () => {
    window.dispatchEvent(new Event("aether-sketch-normal-view"));
  });
}
