import { designTabs, withDesignSections } from "./tools/design-sections";
import {
  cadRibbonWorkspaces,
  type CADRibbonWorkspaceDefinition,
  type CADRibbonWorkspaceID,
  type CADToolDefinition,
} from "./cad-tool-catalog";

/** Ribbon layouts per open document type. "project" preserves the complete
 * legacy arrangement; the other types refine it. Layouts only select and
 * filter the shared catalog — tool meaning and grouping stay in
 * cad-tool-catalog so there is exactly one definition of every tool. */
export type CADDocumentType = "part" | "assembly" | "drawing" | "project";

interface CADToolbarLayout {
  tabs: readonly CADRibbonWorkspaceID[];
  excludeTools?: readonly string[];
}

/** Every tray the ribbon shows. View is not one of them: the top bar is for
 *  modelling, and orientation/display/scene/material/ground/panels are
 *  rendering and layout controls. Each of its groups is a right sidebar panel
 *  instead (`react/panels/view-tools.tsx`); the tray stays in the catalog,
 *  which is still the one definition of every tool. */
const RIBBON_TABS: readonly CADRibbonWorkspaceID[] = cadRibbonWorkspaces
  .map((workspace) => workspace.id)
  .filter((id) => id !== "view" && id !== "sketch" && id !== "home");

const LAYOUTS: Record<CADDocumentType, CADToolbarLayout> = {
  project: { tabs: RIBBON_TABS },
  part: {
    // Fusion's Design workspace, in its order: Solid, Surface, Mesh, Sheet
    // Metal, Plastic, then Manage and Utilities. No permanent Sketch tab —
    // `sketchContextTab` puts the same tray up while a sketch is being edited,
    // which is the only time its tools apply. Create Sketch starts one from
    // Solid > Modeling.
    tabs: ["solid", "surface", "mesh", "sheet-metal", "framing", "plastic", "manage", "output"],
    // Assembly authoring does not belong in a Part document's toolbar.
    excludeTools: ["home-select-component"],
  },
  // Onshape's Assembly workspace: Build, Mates, Relations, Inspect. Not a
  // Design tab set — an assembly has no Surface, Mesh or Sheet Metal work.
  assembly: {
    tabs: ["assembly-build", "assembly-mates", "assembly-relations", "assembly-inspect", "manage", "output"],
  },
  drawing: { tabs: RIBBON_TABS },
};

export function toolbarTabsFor(
  type: CADDocumentType,
): readonly CADRibbonWorkspaceDefinition[] {
  return LAYOUTS[type].tabs
    .map((id) => cadRibbonWorkspaces.find((workspace) => workspace.id === id))
    .filter((workspace): workspace is CADRibbonWorkspaceDefinition => Boolean(workspace));
}

/** Resolve the workspace to render: unknown or excluded tabs fall back to the
 * layout's first tab. Design categories remain in place even when their
 * specialized operations are not available yet. Other empty groups drop. */
export function toolbarWorkspaceFor(
  type: CADDocumentType,
  id: CADRibbonWorkspaceID,
): CADRibbonWorkspaceDefinition {
  const layout = LAYOUTS[type];
  const tabs = toolbarTabsFor(type);
  const workspace = withDesignSections(tabs.find((entry) => entry.id === id) ?? tabs[0]);
  const excluded = new Set(layout.excludeTools ?? []);
  return {
    ...workspace,
    groups: workspace.groups
      .map((group) => ({
        ...group,
        tools: group.tools.filter((tool) => Boolean(tool.action) && !excluded.has(tool.id)).map(connectedTool),
      }))
      .filter((group) => designTabs.has(workspace.id) || group.tools.length > 0),
  };
}

/* ------------------------------------------------------------------ */
/* Fusion-style layouts: tabs of sections, each with prominent tools   */
/* plus the full list in the section's dropdown. Tool ids reference    */
/* the shared catalog — the single definition of every tool.           */

export interface CADToolbarSection {
  id: string;
  label: string;
  /** Tool ids shown as large icons. */
  visible: readonly string[];
  /** Tool ids in the section dropdown (the complete section list). */
  menu: readonly string[];
}

export interface CADToolbarTab {
  id: string;
  label: string;
  sections: readonly CADToolbarSection[];
}

/** Runtime UI contains executable commands only. Planned names stay in the audit catalog. */
function connectedTool(tool: CADToolDefinition): CADToolDefinition {
  const variants=tool.variants?.filter(variant=>Boolean(variant.action));
  return {...tool,variants:variants?.length?variants:undefined};
}

/** Includes variants: a tool inside a dropdown is still a tool the toolbar can
 *  be asked to render or run, and looking it up must not come back empty. */
const TOOL_INDEX: ReadonlyMap<string, CADToolDefinition> = new Map(
  cadRibbonWorkspaces.flatMap((workspace) =>
    workspace.groups.flatMap((group) =>
      group.tools.flatMap((tool) =>
        [tool, ...(tool.variants ?? [])].map((entry) => [entry.id, entry] as const),
      ),
    ),
  ),
);

export function toolbarToolById(id: string): CADToolDefinition | undefined {
  const tool=TOOL_INDEX.get(id);
  return tool?.action ? connectedTool(tool) : undefined;
}

/** Accept family IDs or already expanded IDs without repeating variants. */
export function toolbarMenuToolsFor(ids: readonly string[]): CADToolDefinition[] {
  const seen = new Set<string>();
  return ids.flatMap(id => {
    const tool = toolbarToolById(id);
    return tool ? [tool, ...(tool.variants ?? [])] : [];
  }).filter(tool => {
    if (seen.has(tool.id)) return false;
    seen.add(tool.id);
    return true;
  });
}

/** A catalog workspace, presented as Fusion-style sections.
 *
 *  The presentations differ in design, not in content: every arrangement shows
 *  the same tools, in the same order, in the same groups. Only how they are
 *  drawn changes — the traditional ribbon lays a group out flat, this one
 *  gives each group a few buttons and an overflow menu.
 *
 *  The Part ribbon used to be a second, hand-written taxonomy (Solid, Surface,
 *  Mesh, Sheet Metal, Plastic) that re-listed tool ids. It drifted: it named 69
 *  of 205 tools, duplicated some across tabs, left out every View command, and
 *  did not include the FreeCAD Build button at all.
 */
function fusionTabFor(
  workspace: CADRibbonWorkspaceDefinition,
  tabID: string = workspace.id,
): CADToolbarTab {
  return {
    id: tabID,
    label: workspace.label,
    sections: workspace.groups.map((group) => ({
      id: `${tabID}-${group.id}`,
      label: group.label,
      // Primaries are the buttons; the menu is the whole group, variants
      // included, so collapsing a tool behind a caret never hides it.
      visible: group.tools.slice(0, group.visibleToolCount ?? (group.singleTool ? 1 : 8)).map((tool) => tool.id),
      menu: group.tools.flatMap((tool) => [
        tool.id,
        ...(tool.variants ?? []).map((variant) => variant.id),
      ]),
    })),
  };
}

/** Contextual Sketch tab shown while a sketch is being edited, built from
 * the catalog's sketch workspace groups. */
export function sketchContextTab(): CADToolbarTab {
  const sketch = cadRibbonWorkspaces.find((workspace) => workspace.id === "sketch");
  const tab = sketch
    ? fusionTabFor(sketch, "sketch-context")
    : { id: "sketch-context", label: "Sketch", sections: [] };
  // Reuse the solid commands: authoring finishes the sketch before opening
  // the feature editor and carries its selected region into that editor.
  return {...tab,sections:[{
    id:'sketch-context-solid',label:'Solid',visible:['solid-extrude','solid-cut'],
    menu:['solid-extrude','solid-revolve','solid-sweep','solid-loft','solid-cut'],
  },...tab.sections]};
}

/** Every document layout uses the same contextual ribbon presentation. */
export function fusionTabsFor(type: CADDocumentType): readonly CADToolbarTab[] {
  return toolbarTabsFor(type).map(workspace => fusionTabFor(toolbarWorkspaceFor(type, workspace.id)));
}
