/** The CAD workbench trays: one panel per file.
 *
 *  They all lived inside AetherCADShell.tsx, which made the shell the only
 *  place any of them could be found or changed. Only the panels the shell
 *  mounts are published here; what several panels share they take from
 *  ./shared directly, so the barrel stays a list of trays.
 */
export { ActionItemsPanel, CommentsPanel, DocumentNotesPanel } from "./notes";
export { ItemsPanel } from "./items";
export { ParametersPanel } from "./parameters";
export { MatesPanel } from "./mates";
export { InspectPanel } from "./inspect";
export { VisualizationPanel } from "./visualization";
export { InspectorPanel } from "./inspector";
export { WorkbenchBottomPanel } from "./bottom";
export { ViewToolsPanel, viewToolGroups } from "./view-tools";

export { AdvisorPanel, CreateVersionPanel, PartManagerPanel, RemindersPanel } from "./rail";
