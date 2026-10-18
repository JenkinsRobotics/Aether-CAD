/** The ribbon catalog: one tray per file, assembled here.
 *
 *  Order is the tab order. Adding a tray means adding a file and one line.
 */
import type { CADRibbonWorkspaceDefinition, CADRibbonWorkspaceID } from "./shared";
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
];

export function cadRibbonWorkspace(id: CADRibbonWorkspaceID): CADRibbonWorkspaceDefinition {
  return cadRibbonWorkspaces.find((workspace) => workspace.id === id) ?? cadRibbonWorkspaces[0];
}
