/** The ribbon catalog: one tray per file, assembled here.
 *
 *  Order is the tab order. Adding a tray means adding a file and one line.
 */
import type { CADRibbonWorkspaceDefinition, CADRibbonWorkspaceID, CADToolDefinition, CADToolGroupDefinition } from "./shared";
import { sketchWorkspace } from "./sketch";
import { solidWorkspace } from "./solid";
import { surfaceWorkspace } from "./surface";
import { meshWorkspace } from "./mesh";
import { sheetMetalWorkspace } from "./sheet-metal";
import { framingWorkspace } from "./framing";
import { plasticWorkspace } from "./plastic";
import { assemblyBuildWorkspace } from "./assembly-build";
import { assemblyMatesWorkspace } from "./assembly-mates";
import { assemblyRelationsWorkspace } from "./assembly-relations";
import { assemblyInspectWorkspace } from "./assembly-inspect";
import { viewWorkspace } from "./view";
import { manageWorkspace } from "./manage";
import { outputWorkspace } from "./output";

export * from "./shared";

/** Release builds ship no placeholders (Jonathan, 2026-11-26): a tool with no
 *  action is left out, and so is a group or tray it leaves empty. The tray files
 *  keep those entries, with their reasons, as the record of what is missing. */
const shippedTools = (tools: readonly CADToolDefinition[]): CADToolDefinition[] => tools.flatMap(tool => {
  const variants = tool.variants && shippedTools(tool.variants);
  return tool.action ? [variants ? { ...tool, variants } : tool] : [];
});
export const shippedGroups = (groups: readonly CADToolGroupDefinition[]): CADToolGroupDefinition[] =>
  groups.map(group => ({ ...group, tools: shippedTools(group.tools) })).filter(group => group.tools.length);

export const cadRibbonWorkspaces: readonly CADRibbonWorkspaceDefinition[] = [
  solidWorkspace,
  sketchWorkspace,
  surfaceWorkspace,
  meshWorkspace,
  sheetMetalWorkspace,
  framingWorkspace,
  plasticWorkspace,
  assemblyBuildWorkspace,
  assemblyMatesWorkspace,
  assemblyRelationsWorkspace,
  assemblyInspectWorkspace,
  viewWorkspace,
  manageWorkspace,
  outputWorkspace,
].map(workspace => ({ ...workspace, groups: shippedGroups(workspace.groups) })).filter(workspace => workspace.groups.length);

export function cadRibbonWorkspace(id: CADRibbonWorkspaceID): CADRibbonWorkspaceDefinition {
  return cadRibbonWorkspaces.find((workspace) => workspace.id === id) ?? cadRibbonWorkspaces[0];
}
