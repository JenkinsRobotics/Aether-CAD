import { afterEach, expect, it, vi } from "vitest";
import { cadAppearance, defaultCADAppearance, type CADFloorMode } from "../../cad-appearance-store";
import { environmentMenuItems, selectEnvironmentMenuItem } from "./environment-menu";
import { cadPresentation } from "../../cad-presentation-store";
import { cadCameraPresentation } from "../../cad-camera-presentation-store";
const before = cadAppearance.snapshot();
afterEach(() => cadAppearance.dispatch({ type: "apply-saved-preset", id: "test-reset", appearance: before }));
const choose = (id: string) => selectEnvironmentMenuItem(id);

it.each(["none", "grid", "floor", "both"] as CADFloorMode[])("toggles grid and floor independently from %s", mode => {
  cadAppearance.dispatch({ type: "set-floor-mode", mode });
  choose("grid");
  expect(["floor", "both"].includes(cadAppearance.snapshot().floorMode)).toBe(["floor", "both"].includes(mode));
  expect(["grid", "both"].includes(cadAppearance.snapshot().floorMode)).toBe(!["grid", "both"].includes(mode));
  choose("grid");
  expect(cadAppearance.snapshot().floorMode).toBe(mode);
  choose("floor");
  expect(["grid", "both"].includes(cadAppearance.snapshot().floorMode)).toBe(["grid", "both"].includes(mode));
  choose("floor");
  expect(cadAppearance.snapshot().floorMode).toBe(mode);
});
it("routes supported rendering and visibility options to their actual owners", () => {
  const camera = vi.fn(), release = cadCameraPresentation.registerActionHandler(camera);
  try {
    for (const style of ["shaded", "shaded-edges", "wireframe", "hidden-line", "ghost", "accessibility", "zebra", "draft-analysis", "curvature-map"] as const) {
      choose(`display:${style}`);
      const items = environmentMenuItems(cadAppearance.snapshot());
      expect(cadAppearance.snapshot().displayStyle).toBe(style);
      expect(items.filter(item => item.id.startsWith("display:") && item.checked).map(item => item.id)).toEqual([`display:${style}`]);
    }
    choose("edges"); expect(cadAppearance.snapshot().edgesVisible).toBe(!before.edgesVisible);
    choose("shadows"); expect(cadAppearance.snapshot().contactShadowsVisible).toBe(!before.contactShadowsVisible);
    expect(environmentMenuItems(defaultCADAppearance).some(item => ['view-cube','camera'].includes(item.id))).toBe(false);
    choose("projection:orthographic"); expect(camera).not.toHaveBeenCalled();
  } finally { release(); }
});

it("opens the existing environment editor without switching workspaces", () => {
  const previous = cadPresentation.snapshot();
  try {
    choose("rendering");
    expect(cadPresentation.snapshot().activePanel).toBe("rendering");
    expect(cadPresentation.snapshot().propertyPanelRequest).toBe((previous.propertyPanelRequest ?? 0) + 1);
  } finally { cadPresentation.patch(previous); }
});
