import { describe, expect, it } from "vitest";
import { sketchConstraintCatalog } from "./sketch/constraint-catalog";
import { cadRibbonWorkspace, cadRibbonWorkspaces } from "./cad-tool-catalog";

/** Assembly is four trays — Build, Mates, Relations, Inspect — so a question
 *  about "the assembly tools" is a question about all four. */
const assemblyTools = () =>
  cadRibbonWorkspaces
    .filter((workspace) => workspace.id.startsWith("assembly-"))
    .flatMap((workspace) => workspace.groups.flatMap((group) => group.tools));

describe("CAD tool catalog", () => {
  it("owns the complete traditional workspace structure", () => {
    expect(cadRibbonWorkspaces.map(({ id }) => id)).toEqual([
      "solid",
      "sketch",
      "surface",
      "mesh",
      "sheet-metal",
      "framing",
      "plastic",
      "assembly-build",
      "assembly-mates",
      "assembly-relations",
      "assembly-inspect",
      "view",
      "manage",
      "output",
    ]);
    expect(cadRibbonWorkspace("assembly-mates").label).toBe("Mates");
  });

  it("keeps every tool unique and either actionable or honestly gated", () => {
    // Variants count: a tool inside a dropdown is still a tool the user can
    // run, so it must be unique and actionable like any other.
    const tools = cadRibbonWorkspaces.flatMap((workspace) =>
      workspace.groups.flatMap((group) =>
        group.tools.flatMap((definition) => [definition, ...(definition.variants ?? [])]),
      ),
    );
    expect(tools.find(tool => tool.id === "solid-boolean")?.action).toBe("feature-boolean");
    expect(tools.some(tool=>tool.id === "sketch-vector" && Boolean(tool.action))).toBe(true);
    expect(new Set(tools.map(({ id }) => id)).size).toBe(tools.length);
    for (const definition of tools) {
      expect(Boolean(definition.action) || Boolean(definition.unavailableReason)).toBe(true);
      if (!definition.action) expect(definition.unavailableReason?.length).toBeGreaterThan(20);
    }
  });

  it("covers the core modeling, assembly, inspection, and output families", () => {
    // Variants count here too: a tool behind a caret is still reachable, so
    // grouping Loft under Extrude must not read as Loft having been removed.
    const ids = new Set(cadRibbonWorkspaces.flatMap((workspace) =>
      workspace.groups.flatMap((group) =>
        group.tools.flatMap((tool) => [tool.id, ...(tool.variants ?? []).map((v) => v.id)]),
      ),
    ));
    for (const id of [
      "sketch-spline",
      "solid-hole",
      "solid-loft",
      "solid-pattern",
      "assembly-revolute",
      "assembly-slider",
      "assembly-gear",
      "assembly-interference",
      "assembly-ground",
      "assembly-suppress",
      "assembly-remove",
      "view-wireframe",
      "manage-configurations",
      "output-step",
      "output-dxf",
      "output-cut-list",
      // Onshape's sheet metal list, greyed until the engine can build it.
      "sheet-model",
      "sheet-hem",
      "sheet-jog",
      "sheet-corner-break",
      "sheet-finish-flex-pcb",
      // Onshape's framing list, greyed until there is a profile library.
      "framing-frame",
      "framing-trim",
      "framing-gusset",
      "framing-end-cap",
      "framing-cut-list",
    ]) expect(ids.has(id)).toBe(true);
    expect(cadRibbonWorkspace("view").groups.flatMap((group) => group.tools)
      .find(({ id }) => id === "view-hidden-line")?.action).toBe("display-hidden-line");
    expect(cadRibbonWorkspace("view").groups.flatMap((group) => group.tools)
      .filter(({ id }) => ["view-front", "view-back", "view-left", "view-right", "view-top", "view-bottom"].includes(id))
      .every(({ action }) => Boolean(action))).toBe(true);
    expect(cadRibbonWorkspace("view").groups.flatMap((group) => group.tools)
      .filter(({ id }) => id.startsWith("view-ground-") || id.startsWith("view-background-") || id.startsWith("view-finish-") || id === "view-feature-edges" || id === "view-reset-appearance")
      .every(({ action }) => Boolean(action))).toBe(true);
    expect(assemblyTools()
      .find(({ id }) => id === "assembly-insert")?.action).toBe("assembly-insert-component");
    expect(assemblyTools()
      .find(({ id }) => id === "assembly-connector")?.action).toBe("assembly-add-connector");
    // Each mate kind is its own button now that the engine solves thirteen of
    // them, so Fastened runs the fastened command rather than a generic dialog
    // that then asks which kind — picking the mate is the gesture.
    expect(assemblyTools()
      .find(({ id }) => id === "assembly-fixed")?.action).toBe("assembly-mate-fastened");
    expect(assemblyTools()
      .find(({ id }) => id === "assembly-revolute")?.action).toBe("assembly-mate-revolute");
    // The two Onshape mates FreeCAD has no joint for stay greyed, with a
    // reason, rather than being offered and refused after authoring.
    expect(assemblyTools()
      .find(({ id }) => id === "assembly-tangent")?.action).toBeUndefined();
    expect(assemblyTools()
      .find(({ id }) => id === "assembly-mate-suppress")?.action).toBe("assembly-toggle-mate-suppressed");
    expect(assemblyTools()
      .find(({ id }) => id === "assembly-mate-dof-value")?.action).toBe("assembly-set-mate-dof-value");
    expect(assemblyTools()
      .find(({ id }) => id === "assembly-mate-dof-limits")?.action).toBe("assembly-edit-mate-dof-limits");
    expect(assemblyTools()
      .find(({ id }) => id === "assembly-relation-create")?.action).toBe("assembly-create-relation");
    expect(assemblyTools()
      .find(({ id }) => id === "assembly-mate-remove")?.action).toBe("assembly-remove-mate");
  });
});

it("exposes spline point insertion in the spline dropdown", () => {
  const spline = cadRibbonWorkspace("sketch").groups.flatMap(g => g.tools).find(t => t.id === "sketch-spline");
  expect(spline?.variants?.some(v => v.action === "sketch-insert-spline-point" && v.label === "Insert spline point")).toBe(true);
});

// Onshape puts relationships behind one Constrain button and dimensions behind
// one Dimension button, rather than lining up 26 buttons in the ribbon.
describe("sketch Constrain and Dimension tools", () => {
  const groupById = (id: string) =>
    cadRibbonWorkspaces.flatMap((workspace) => workspace.groups).find((group) => group.id === id)!;
  const constrainGroup = groupById("sketch-constraints");
  const dimensionGroup = groupById("sketch-dimensions");

  it("shows exactly one icon for Constrain and one for Dimension", () => {
    expect(constrainGroup.tools.map((tool) => tool.id)).toEqual(["sketch-constrain"]);
    expect(dimensionGroup.tools.map((tool) => tool.id)).toEqual(["sketch-dimension"]);
  });

  it("lists every relationship in Onshape's order behind Constrain", () => {
    const constrain = constrainGroup.tools[0];
    const choices = [constrain, ...(constrain.variants ?? [])];
    expect(choices.map((choice) => choice.label)).toEqual(
      sketchConstraintCatalog.map((entry) => entry.label),
    );
    // Every choice runs a real command.
    for (const choice of choices) expect(choice.action).toBeTruthy();
  });

  it("uses one inferred Dimension tool without type variants", () => {
    const dimension = dimensionGroup.tools[0];
    expect(dimension.label).toBe("Dimension");
    expect(dimension.action).toBe("sketch-constraint-distance");
    expect(dimension.variants).toBeUndefined();
  });
});

it("keeps viewport controls out of the sketch ribbon", () => {
  const sketch = cadRibbonWorkspaces.find((workspace) => workspace.id === "sketch")!;
  const ids = new Set(
    sketch.groups.flatMap((group) =>
      group.tools.flatMap((tool) => [tool.id, ...(tool.variants ?? []).map((v) => v.id)]),
    ),
  );
  // Select, Pan and Fit are viewport controls, not sketch tools. Escape returns
  // to Select, so removing them strands nobody.
  for (const id of ["sketch-select", "sketch-pan", "sketch-fit"])
    expect(ids.has(id), `${id} should not be a sketch ribbon tool`).toBe(false);
  expect(sketch.groups.map((group) => group.label)).not.toContain("Navigate");
});
