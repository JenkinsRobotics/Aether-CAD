import { describe, expect, it } from "vitest";
import { drawingConstraintKinds } from "@aether/core/sketch";
import {
  isDimensionConstraint,
  sketchConstraintCatalog,
  sketchConstraintEntry,
  sketchDimensionKinds,
} from "./constraint-catalog";

describe("sketch constraint catalog", () => {
  it("matches Onshape's Constrain menu, in order", () => {
    expect(sketchConstraintCatalog.map((entry) => entry.label)).toEqual([
      "Coincident", "Pierce", "Concentric", "Parallel", "Tangent", "Horizontal", "Vertical",
      "Perpendicular", "Equal", "Midpoint", "Normal", "Symmetric", "Fix", "Curvature",
    ]);
  });

  it("carries Onshape's shortcuts", () => {
    expect(sketchConstraintEntry("coincident")?.shortcut).toBe("i");
    expect(sketchConstraintEntry("pierce")?.shortcut).toBe("shift g");
    expect(sketchConstraintEntry("perpendicular")?.shortcut).toBe("shift l");
    expect(sketchConstraintEntry("curvature")?.shortcut).toBe("shift u");
  });

  it("only names constraints the engine can actually apply", () => {
    const supported = new Set<string>(drawingConstraintKinds);
    for (const entry of sketchConstraintCatalog)
      expect(supported.has(entry.kind), `engine cannot apply ${entry.kind}`).toBe(true);
    for (const kind of sketchDimensionKinds)
      expect(supported.has(kind), `engine cannot apply ${kind}`).toBe(true);
  });

  it("gives every entry a distinct vector icon", async () => {
    const { constraintIcons } = await import("./constraint-icons");
    const icons = sketchConstraintCatalog.map(entry => constraintIcons[entry.icon]);
    expect(new Set(icons).size).toBe(icons.length);
    for (const icon of icons) {
      expect(icon).toContain('viewBox="0 0 24 24"');
      expect(icon).not.toContain("<text");
    }
  });

  it("separates dimensions from relationships", () => {
    expect(isDimensionConstraint("radius")).toBe(true);
    expect(isDimensionConstraint("horizontal")).toBe(false);
    for (const entry of sketchConstraintCatalog)
      expect(isDimensionConstraint(entry.kind)).toBe(false);
  });
});
