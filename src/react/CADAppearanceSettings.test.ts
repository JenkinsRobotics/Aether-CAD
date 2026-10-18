import { expect, test } from "vitest";
import { aetherViewportThemes } from "@aether/ui";
import { defaultCADAppearance } from "../cad-appearance-store";

// The stage is chosen in the suite's vocabulary: CAD's Background row lists the
// shared viewport themes, not a private set. Until 2026-09-29 it offered
// "slate", which is not a CADBackgroundPreset, so picking it did nothing.
test("every CAD render environment has a viewport theme of the same name, and slate is not one", () => {
  const ids = new Set(aetherViewportThemes.map((theme) => theme.id));
  for (const preset of ["midnight", "graphite", "cad-light", "blueprint", "onshape"]) {
    expect(ids.has(preset), preset).toBe(true);
  }
  expect(ids.has(defaultCADAppearance.background)).toBe(true);
  expect(ids.has("slate")).toBe(false);
  expect(ids.size).toBeGreaterThan(5);
});
