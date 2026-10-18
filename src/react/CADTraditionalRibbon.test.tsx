import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CADTraditionalRibbon } from "./CADTraditionalRibbon";
import type { CADRibbonWorkspaceID } from "../cad-tool-catalog";

describe("CADTraditionalRibbon", () => {
  it("renders all traditional workspaces and document context without duplicating suite navigation", () => {
    const html = renderToStaticMarkup(<CADTraditionalRibbon
      activeWorkspace="solid"
      partOpen
      onSelectWorkspace={vi.fn()}
      onAction={vi.fn()}
    />);
    expect(html).not.toContain('aria-label="Aether suite stages"');
    for (const label of ["Solid", "Mates", "Relations", "Manage", "Output"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain('data-ribbon-workspace="solid"');
    expect(html).not.toContain('aria-label="Open documents"');
  });

  it("omits unimplemented features from the working toolbar", () => {
    // Assembly is four tabs now, so each reason is checked where it lives.
    const tab = (workspace: CADRibbonWorkspaceID) => renderToStaticMarkup(<CADTraditionalRibbon
      activeWorkspace={workspace}
      partOpen={false}
      onSelectWorkspace={vi.fn()}
      onAction={vi.fn()}
    />);
    const build = tab("assembly-build");
    expect(build).not.toContain('data-tool-id="assembly-cut"');
    expect(build).toContain("Create or open a persistent Assembly before saving it.");
    const mates = tab("assembly-mates");
    expect(mates).toContain('data-tool-id="assembly-revolute"');
    const inspect = tab("assembly-inspect");
    expect(inspect).not.toContain('data-tool-id="assembly-interference"');
  });

  it("part documents render the Fusion layout with section dropdowns and contextual Sketch tab", () => {
    const html = renderToStaticMarkup(<CADTraditionalRibbon
      documentType="part"
      activeWorkspace="solid"
      partOpen
      documentName="Part 1"
      onSelectWorkspace={vi.fn()}
      onAction={vi.fn()}
    />);
    // The Fusion layout is a presentation of the same catalog, not a second
    // taxonomy. It used to invent Solid/Surface/Mesh/Sheet Metal/Plastic and
    // named 69 of 205 tools, with no View tab at all.
    for (const label of ["Solid", "Surface", "Mesh", "Sheet Metal", "Framing", "Plastic", "Manage", "Output"])
      expect(html).toContain(`aria-label="${label}"`);
    // One Sketch tab, and it is the contextual one: a permanent tab of tools
    // that only apply inside a sketch put two "Sketch" tabs on the ribbon.
    expect(html).not.toContain('aria-label="Sketch"');
    // View is not a modelling tab; it is the viewport's right-hand rail.
    expect(html).not.toContain('aria-label="View"');
    // A Part is not an Assembly; those tabs are excluded by the layout, not
    // by the presentation.
    for (const tab of ["Build", "Mates", "Relations"])
      expect(html).not.toContain(`aria-label="${tab}"`);
    // Every group still gets its own overflow menu.
    expect(html).toMatch(/aria-label="[^"]+ tools"/);
    const sketching = renderToStaticMarkup(<CADTraditionalRibbon
      documentType="part"
      sketchEditing
      activeWorkspace="solid"
      partOpen
      documentName="Part 1"
      onSelectWorkspace={vi.fn()}
      onAction={vi.fn()}
    />);
    // Finish Sketch lives on the sketch feature window's accept control, not
    // in the ribbon, and the Floating tools switch was removed.
    expect(sketching).not.toContain("Finish Sketch");
    expect(sketching).not.toContain("Floating tools");
    expect(sketching).toContain('data-ribbon-workspace="sketch-context"');
  });

  it("keeps the six category menus on every design tab without inventing runnable tools", () => {
    for (const activeWorkspace of ["surface", "mesh", "sheet-metal", "framing", "plastic"] as const) {
      const html = renderToStaticMarkup(<CADTraditionalRibbon documentType="part"
        activeWorkspace={activeWorkspace} partOpen onSelectWorkspace={vi.fn()} onAction={vi.fn()} />);
      for (const category of ["Create", "Modify", "Construct", "Inspect", "Insert", "Select"])
        expect(html, `${activeWorkspace}/${category}`).toContain(`aria-label="${category} tools"`);
      expect(html).toContain('data-tool-id="solid-plane"');
      expect(html).toContain('data-tool-id="solid-inspect"');
      expect(html).not.toContain('data-tool-id="surface-extrude"');
    }
  });
});
// Onshape puts every relationship behind one Constrain button with a dropdown,
// and every dimension type behind one Dimension button — not a row of 26.
it("renders one inferred Dimension button alongside the Constrain dropdown", () => {
  const html = renderToStaticMarkup(<CADTraditionalRibbon
    activeWorkspace="sketch" sketchEditing
    partOpen
    documentName="Part 1"
    onSelectWorkspace={vi.fn()}
    onAction={vi.fn()}
  />);
  // The two collapsed buttons exist...
  expect(html).toContain('data-tool-id="sketch-constrain"');
  expect(html).toContain('data-tool-id="sketch-dimension"');
  // ...each with a variants dropdown.
  expect(html).toContain('aria-label="Coincident variants"');
  expect(html).not.toContain('aria-label="Dimension variants"');
  // ...and the relationships are NOT flat buttons in the ribbon any more.
  for (const kind of ["horizontal", "vertical", "parallel", "perpendicular", "tangent"])
    expect(html, `${kind} should live in the dropdown`).not.toContain(
      `data-tool-id="sketch-constraint-${kind}"`,
    );
});

describe("tool variants", () => {
  /** The Part ribbon is the Fusion layout; the Sketch tab only exists while a
   *  sketch is open, which is where the drawing tools live. */
  const sketchRibbon = () => renderToStaticMarkup(<CADTraditionalRibbon
    activeWorkspace="sketch"
    documentType="part"
    sketchEditing
    partOpen
    onSelectWorkspace={vi.fn()}
    onAction={vi.fn()}
  />);

  it("gives a tool with variants a caret, in the Part ribbon too", () => {
    // The traditional ribbon had these; the Fusion layout a Part document
    // actually shows did not, so Line, Rectangle, Arc and the rest appeared
    // as flat buttons with their variants unreachable.
    const html = sketchRibbon();
    // A button carries the tool's name; the menu names the kind. "Inscribed
    // polygon" as a button was the variant's name doing the tool's job, and it
    // is what made the buttons uneven and the labels clip.
    for (const tool of ["Line", "Rectangle", "Arc", "Circle", "Polygon", "Spline"])
      expect(html, `${tool} should carry a variants caret`)
        .toContain(`aria-label="${tool} variants"`);
  });

  it("carries a caret for every grouped tool and none for the rest", () => {
    // A menu's items only exist once it is opened, so static markup can show
    // the triggers but not their contents. Count the triggers instead: one
    // per tool that has variants, and the section overflow menus.
    const html = sketchRibbon();
    const carets = html.match(/aria-label="[^"]+ variants"/g) ?? [];
    // One caret per tool, never two for the same one.
    expect(carets.length).toBe(new Set(carets).size);
    expect(carets.length).toBeGreaterThanOrEqual(6);
  });

  it("gives each section its own overflow menu, the way Onshape's Create does", () => {
    const html = sketchRibbon();
    expect(html).toContain('aria-label="Create tools"');
    expect(html).toContain('aria-label="Modify tools"');
  });

  it("a tool without variants gets no caret", () => {
    const html = sketchRibbon();
    expect(html).not.toContain('aria-label="Point variants"');
  });
});

it('compact mode exposes direct modeling tools with categories and switches to sketch context', () => {
  vi.stubGlobal('localStorage', {getItem: () => 'compact'});
  try {
    const props = {documentType:'part' as const, activeWorkspace:'solid' as const, partOpen:true, onSelectWorkspace:vi.fn(), onAction:vi.fn()};
    const html = renderToStaticMarkup(<CADTraditionalRibbon {...props} />);
    expect(html).toContain('data-icon-strip="true"');
    expect(html).toContain('aria-label="Solid"');
    expect(html).toContain('data-tool-id="solid-extrude"');
    expect(html).not.toContain('aria-label="Surface tools"');
    const sketch = renderToStaticMarkup(<CADTraditionalRibbon {...props} sketchEditing />);
    expect(sketch).toContain('aria-label="Sketch"');
    expect(sketch).toContain('aria-label="Rectangle variants"');
    expect(sketch).not.toContain('aria-label="Surface tools"');
  } finally { vi.unstubAllGlobals(); }
});


it("shows only Inspect and Section as primary Inspection tools", () => {
  const html = renderToStaticMarkup(<CADTraditionalRibbon activeWorkspace="solid" partOpen onSelectWorkspace={vi.fn()} onAction={vi.fn()} />);
  expect(html).toContain('data-tool-id="solid-inspect"');
  expect(html).toContain('data-tool-id="solid-section"');
  expect(html).not.toContain('data-tool-id="solid-properties"');
  expect(html).not.toContain('data-tool-id="solid-interference"');
  expect(html).toContain('aria-label="Inspect tools"');
});
