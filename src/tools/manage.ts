/** Manage — configuration and system tools; file actions belong to document controls. */
import { analysisProducer, projectProducer, tool, type CADRibbonWorkspaceDefinition } from "./shared";

export const manageWorkspace: CADRibbonWorkspaceDefinition = {
  id: "manage",
  label: "Manage",
  groups: [
    { id: "manage-project", label: "Project", tools: [
      tool("manage-configurations", "Configurations", "properties", undefined, projectProducer),
      tool("manage-templates", "Templates", "document", undefined, projectProducer),
    ] },
    { id: "manage-system", label: "System", tools: [
      tool("manage-preferences", "Preferences", "settings", "show-preferences"),
      tool("manage-addins", "Add-ins", "add", undefined, "Requires a signed extension host and permission model."),
      tool("manage-pdm", "Project Data", "document", undefined, "Requires a persistent document-management provider."),
      tool("manage-check", "Design Check", "check", undefined, analysisProducer),
      tool("manage-help", "Help", "help", "show-help"),
    ] },
  ],
};
