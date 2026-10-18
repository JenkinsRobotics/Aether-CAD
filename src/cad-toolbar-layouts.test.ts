import { describe, expect, it } from "vitest";
import { fusionTabsFor, toolbarMenuToolsFor, sketchContextTab, toolbarTabsFor, toolbarToolById, toolbarWorkspaceFor } from "./cad-toolbar-layouts";
import { cadRibbonWorkspaces } from "./cad-tool-catalog";
import { sketchConstraintCatalog } from "./sketch/constraint-catalog";

/** View is a viewport rail, not a ribbon tab: the top bar is for modelling. */
const RIBBON_TABS = cadRibbonWorkspaces.map((w) => w.id).filter((id) => id !== "view" && id !== "sketch" && id !== "home");

describe("per-document-type toolbar layouts", () => {
  it("project preserves the complete legacy ribbon", () => {
    expect(toolbarTabsFor("project").map((w) => w.id)).toEqual(RIBBON_TABS);
    const home = toolbarWorkspaceFor("project", "solid");
    expect(home.id).toBe("solid");
    expect(home.groups.map(group => group.label)).toEqual(["Create", "Modify", "Construct", "Inspect", "Insert", "Select"]);
  });

  it("part drops the assembly tab and assembly-scoped home tools", () => {
    const tabs = toolbarTabsFor("part").map((w) => w.id);
    expect(tabs).toEqual(["solid", "surface", "mesh", "sheet-metal", "framing", "plastic", "manage", "output"]);
    // One Sketch tab, and it is the contextual one.
    expect(tabs).not.toContain("sketch");
    expect(sketchContextTab().sections.flatMap((s) => s.menu)).toContain("sketch-line");
    const home = toolbarWorkspaceFor("part", "solid");
    const toolIDs = home.groups.flatMap((group) => group.tools.map((tool) => tool.id));
    expect(toolIDs).not.toContain("home-new-assembly");
    expect(toolIDs).not.toContain("home-select-component");
    expect(toolIDs).toContain("home-import");
    expect(toolIDs).not.toContain("home-new-part");
  });

  it("an excluded tab falls back to the layout's first tab", () => {
    expect(toolbarWorkspaceFor("part", "assembly-mates").id).toBe("solid");
  });

  it("drawing keeps the full arrangement for now", () => {
    expect(toolbarTabsFor("drawing").map((w) => w.id)).toEqual(RIBBON_TABS);
  });
});

describe("fusion part layout", () => {
  it("every referenced tool id resolves in the shared catalog", () => {
    for (const tab of fusionTabsFor("part") ?? [])
      for (const section of tab.sections)
        for (const id of section.menu)
          expect(toolbarToolById(id), `${tab.id}/${section.id}/${id}`).toBeDefined();
  });

  it("shows the same tabs the traditional ribbon does", () => {
    // The presentations differ in design, not in content. The Part ribbon used
    // to be a second taxonomy (Solid, Surface, Mesh, Sheet Metal, Plastic)
    // that named 69 of 205 tools and left out every View command.
    expect((fusionTabsFor("part") ?? []).map((tab) => tab.id))
      .toEqual(toolbarTabsFor("part").map((workspace) => workspace.id));
    expect(fusionTabsFor("project").map(tab => tab.id)).not.toContain("sketch");
    expect((fusionTabsFor("assembly") ?? []).map((tab) => tab.label))
      .toEqual(["Build", "Mates", "Relations", "Inspect", "Manage", "Output"]);
  });

  it("exposes exactly the tools the traditional ribbon does, in the same order", () => {
    // Resolved workspaces on both sides: the traditional ribbon renders
    // toolbarWorkspaceFor, so that is what the Fusion tabs must match.
    const flat = toolbarTabsFor("part").flatMap((workspace) =>
      toolbarWorkspaceFor("part", workspace.id).groups.flatMap((group) =>
        group.tools.flatMap((tool) => [tool.id, ...(tool.variants ?? []).map((v) => v.id)]),
      ),
    );
    const fusion = (fusionTabsFor("part") ?? []).flatMap((tab) =>
      tab.sections.flatMap((section) => section.menu),
    );
    expect(fusion).toEqual(flat);
  });

  it("every section menu contains its own visible tools", () => {
    for (const tab of fusionTabsFor("part") ?? [])
      for (const section of tab.sections)
        for (const id of section.visible) expect(section.menu).toContain(id);
  });

  it("the contextual sketch tab exposes the catalog sketch tools", () => {
    const tab = sketchContextTab();
    expect(tab.sections.length).toBeGreaterThan(0);
    const ids = tab.sections.flatMap((section) => section.menu);
    expect(ids.length).toBeGreaterThan(5);
    for (const id of ids) expect(toolbarToolById(id)).toBeDefined();
  });
});

// Collapsing Constrain to one ribbon button must not hide the relationships in
// the contextual Sketch tab, which renders sections as buttons + a menu and
// does not descend into variants on its own.
describe("contextual Sketch tab", () => {
  const sectionById = (id: string) =>
    sketchContextTab().sections.find((section) => section.id === id)!;
  const constrain = sectionById("sketch-context-sketch-constraints");
  const dimension = sectionById("sketch-context-sketch-dimensions");

  it("shows a single icon per section, each with its own dropdown", () => {
    expect(constrain.visible).toEqual(["sketch-constrain"]);
    expect(dimension.visible).toEqual(["sketch-dimension"]);
  });

  it("keeps relationships and dimensions in separate menus", () => {
    for (const entry of sketchConstraintCatalog.slice(1))
      expect(constrain.menu, `${entry.label} missing from Constrain`).toContain(
        `sketch-constraint-${entry.kind}`,
      );
    expect(dimension.menu).toEqual(["sketch-dimension"]);
    // A dimension must not appear in the Constrain menu, or the split is
    // cosmetic only.
    expect(constrain.menu).not.toContain("sketch-constraint-radius");
    expect(dimension.menu).not.toContain("sketch-constraint-parallel");
  });

  it("resolves every menu entry to a real, runnable tool", () => {
    for (const id of [...constrain.menu, ...dimension.menu]) {
      const definition = toolbarToolById(id);
      expect(definition, `${id} does not resolve`).toBeTruthy();
      expect(definition!.action, `${id} has no command`).toBeTruthy();
    }
  });
});

describe("the Assembly tab", () => {
  const assemblyTools = () =>
    toolbarTabsFor("assembly").flatMap((tab) => tab.groups.flatMap((group) => group.tools));

  it("is Onshape's four tabs, and no Design tabs", () => {
    const tabs = toolbarTabsFor("assembly").map((tab) => tab.id);
    expect(tabs).toEqual([
      "assembly-build", "assembly-mates", "assembly-relations", "assembly-inspect",
      "manage", "output",
    ]);
    // An assembly has no Surface, Mesh, Sheet Metal, Framing or Plastic work.
    for (const design of ["solid", "surface", "mesh", "sheet-metal", "framing", "plastic"])
      expect(tabs).not.toContain(design);
  });

  it("brings parts in from its Build tab", () => {
    expect(assemblyTools().find((tool) => tool.id === "assembly-insert")?.action)
      .toBe("assembly-insert-component");
  });

  it("offers exactly the mates that can be both authored and solved", () => {
    // FreeCAD solves thirteen kinds, but a mate is committed through the
    // workspace's Assembly v1 slice, which takes three. A button needs both
    // halves, or it fails only after the user has authored the whole mate.
    const enabled = assemblyTools()
      .filter((tool) => tool.action?.startsWith("assembly-mate-"))
      .map((tool) => tool.label);
    expect(enabled.sort()).toEqual(["Fastened", "Revolute", "Slider"]);
  });

  it("greys the rest, and says which of the two reasons applies", () => {
    const tools = assemblyTools();
    // Solvable but not yet authorable.
    for (const mate of ["Cylindrical", "Ball", "Distance", "Angle", "Gears", "Belt"]) {
      const tool = tools.find((entry) => entry.label === mate);
      expect(tool, `${mate} should be listed`).toBeTruthy();
      expect(tool!.action).toBeUndefined();
      expect(tool!.unavailableReason).toMatch(/cannot author it yet/);
    }
    // Not solvable at all: FreeCAD has no joint for these.
    for (const mate of ["Planar", "Pin Slot", "Tangent", "Width"]) {
      const tool = tools.find((entry) => entry.label === mate);
      expect(tool!.action).toBeUndefined();
      expect(tool!.unavailableReason).toMatch(/no joint for this mate/);
    }
  });

  it("is kept out of a Part document, where assembly tools do not belong", () => {
    expect(toolbarTabsFor("part").map((tab) => tab.id)).not.toContain("assembly");
  });
});

describe("the View tray is not on the ribbon", () => {
  it("no document type offers a View tab", () => {
    for (const type of ["project", "part", "assembly", "drawing"] as const)
      expect(toolbarTabsFor(type).map((w) => w.id)).not.toContain("view");
  });

  it("but the tray is still in the catalog, with an icon per group for the rail", () => {
    const view = cadRibbonWorkspaces.find((w) => w.id === "view");
    expect(view?.groups.map((group) => group.label))
      .toEqual(["Orientation", "Display", "Scene", "Material", "Ground", "Panels"]);
    for (const group of view?.groups ?? []) expect(group.icon, group.id).toBeTruthy();
  });
});

describe("both presentations honour the layout", () => {
  it("the Fusion tabs exclude what the traditional ribbon excludes", () => {
    const fusionIDs = (fusionTabsFor("part") ?? []).flatMap((tab) =>
      tab.sections.flatMap((section) => [...section.visible, ...section.menu]),
    );
    // Reading the raw tray instead of the resolved workspace put assembly
    // tools on a Part document's Home tab.
    expect(fusionIDs).not.toContain("home-select-component");
    expect(fusionIDs).toContain("home-select-body");
  });
});


describe("selection tray", () => {
  it("exposes one Select button while retaining the real filters in its menu", () => {
    const section = fusionTabsFor("part")!.find(tab => tab.id === "solid")!.sections.find(section => section.label === "Select")!;
    expect(section.visible).toEqual(["home-select-auto"]);
    expect(section.menu).toEqual(["home-select-auto", "selection-directional-tool", "selection-window-tool", "selection-freeform-tool", "selection-paint-tool", "selection-crossing-tool", "selection-clear-tool", "selection-priority-body-tool", "selection-priority-face-tool", "selection-priority-edge-tool", "home-select-body", "home-select-face", "home-select-edge", "home-select-vertex"]);
    expect(toolbarToolById("home-select-auto")?.label).toBe("Select");
  });
});


it("keeps document lifecycle actions out of the ribbon and import under Insert", () => {
  const actions = cadRibbonWorkspaces.flatMap(tab => tab.groups.flatMap(group => group.tools.map(tool => tool.action)));
  for (const action of ["new-part", "open-part", "save-part", "commit-part", "show-recovery"])
    expect(actions).not.toContain(action);
  const home = toolbarWorkspaceFor("part", "solid");
  expect(home.groups.find(group => group.label === "Insert")?.tools.map(tool => tool.action)).toContain("insert-step");
});


it("Home is absent and Sketch is contextual in every document layout", () => {
  for (const type of ["project", "part", "assembly", "drawing"] as const) {
    const ids = fusionTabsFor(type).map(tab => tab.id);
    expect(ids).not.toContain("home");
    expect(ids).not.toContain("sketch");
    expect(ids).not.toContain("sketch-context");
  }
  expect(sketchContextTab().label).toBe("Sketch");
});


it("starts Solid with Create and Modify without manual build commands", () => {
  const solid = toolbarWorkspaceFor("part", "solid");
  expect(solid.groups.slice(0, 2).map(group => group.label)).toEqual(["Create", "Modify"]);
  expect(solid.groups[0].tools.map(tool => tool.id)).toContain("solid-extrude");
  expect(solid.groups[1].tools.map(tool => tool.id)).toContain("solid-cut");
  const actions = solid.groups.flatMap(group => group.tools.map(tool => tool.action));
  expect(actions).not.toContain("rebuild-part");
  expect(actions).not.toContain("freecad-build");
});


it("shows one Construction icon and retains the complete construction menu", () => {
  const section = fusionTabsFor("part").find(tab => tab.id === "solid")!.sections.find(section => section.label === "Construct")!;
  expect(section.visible).toEqual(["solid-plane"]);
  expect(section.menu).toEqual(["solid-plane", "solid-plane-angle", "solid-plane-mid", "solid-plane-three-point"]);
});


it("exposes Inspect and Section while retaining the other inspection actions", () => {
  const section = fusionTabsFor("part").find(tab => tab.id === "solid")!.sections.find(section => section.label === "Inspect")!;
  expect(section.visible).toEqual(["solid-inspect", "solid-section"]);
  expect(section.menu).toEqual(["solid-inspect", "solid-section", "solid-interference", "solid-properties"]);
  expect(toolbarToolById("solid-inspect")?.action).toBe("show-inspect");
});


it("offers only implemented, distinct Insert commands with two primary tools", () => {
  const section = fusionTabsFor("part").find(tab => tab.id === "solid")!.sections.find(section => section.label === "Insert")!;
  expect(section.visible).toEqual(["insert-svg", "insert-canvas"]);
  expect(section.menu).toEqual(["insert-svg", "insert-canvas", "insert-decal", "home-import", "insert-mesh", "insert-mcmaster", "insert-dxf"]);
  expect(section.menu.map(id => toolbarToolById(id)?.action)).toEqual(["insert-vector-svg", "insert-canvas", "insert-decal", "insert-step", "insert-mesh", "insert-mcmaster", "insert-vector-dxf"]);
});

it("preserves all six design categories while omitting unimplemented commands", () => {
 for (const id of ['solid','surface','mesh','sheet-metal','framing','plastic']) {
  const tab=fusionTabsFor('part').find(tab=>tab.id===id)!;
  const labels=tab.sections.map(section=>section.label);
  expect(labels).toEqual(['Create','Modify','Construct','Inspect','Insert','Select']);
  for(const section of tab.sections) for(const tool of toolbarMenuToolsFor(section.menu)) expect(tool.action).toBeTruthy();
 }
 expect(toolbarToolById('mesh-close-holes')).toBeUndefined();
 expect(toolbarWorkspaceFor('part','surface').groups[0].tools).toEqual([]);
 const framing=toolbarWorkspaceFor('part','framing');
 expect(framing.groups.find(group=>group.label==='Construct')?.tools.map(tool=>tool.action)).toContain('feature-plane');
 expect(framing.groups.find(group=>group.label==='Inspect')?.tools.map(tool=>tool.action)).toContain('show-inspect');
 expect(toolbarWorkspaceFor('part','solid').groups[0].tools.map(tool=>tool.id)).toContain('solid-mirror');
 expect(toolbarWorkspaceFor('part','solid').groups[1].tools.map(tool=>tool.id)).toContain('solid-draft');
});

it("expands tool families once even when the section already includes variants", () => {
 for (const kind of ['part','assembly','project','drawing'] as const) {
  for (const tab of fusionTabsFor(kind)) for (const section of tab.sections) {
   const tools=toolbarMenuToolsFor(section.menu);
   expect(tools.map(tool=>tool.id)).toEqual([...new Set(section.menu)]);
  }
 }
 expect(toolbarMenuToolsFor(['solid-fillet','solid-chamfer']).map(tool=>tool.id)).toEqual(['solid-fillet','solid-chamfer']);
});

it("keeps extrusion, revolution, sweep and loft as peer Create tools", () => {
 for (const tabId of ['solid'] as const) {
  const create = toolbarWorkspaceFor('part',tabId).groups[0];
  for (const operation of ['extrude','revolve','sweep','loft']) {
   const tool=create.tools.find(tool=>tool.id===`${tabId}-${operation}`);
   expect(tool).toBeDefined();
   expect(tool?.variants).toBeUndefined();
   expect(fusionTabsFor('part').find(tab=>tab.id===tabId)?.sections[0].visible).toContain(tool!.id);
  }
 }
 expect(toolbarToolById('solid-fillet')?.variants?.map(tool=>tool.id)).toContain('solid-chamfer');
});

it("names and illustrates the three core inspection commands distinctly",()=>{
 expect(['solid-inspect','solid-section','solid-interference'].map(id=>{const tool=toolbarToolById(id)!;return [tool.label,tool.icon,tool.action];})).toEqual([
  ['Measure','measure','show-inspect'],['Section View','split','part-section'],['Interference Analysis','split','part-interference']
 ]);
});

it('connects Plastic Draft and Shell to native feature authoring',()=>{
 const modify=toolbarWorkspaceFor('part','plastic').groups.find(group=>group.label==='Modify')!;
 expect(modify.tools.map(tool=>tool.action)).toEqual(['feature-draft','feature-shell']);
});
