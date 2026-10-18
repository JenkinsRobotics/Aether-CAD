import type { CADRibbonWorkspaceDefinition, CADToolGroupDefinition } from "./shared";
import { solidWorkspace } from "./solid";
import { homeWorkspace } from "./home";

export const designTabs: ReadonlySet<string> = new Set(["solid", "surface", "mesh", "sheet-metal", "framing", "plastic"]);

/** One section taxonomy for design tabs; tool definitions keep their own meaning. */
export function withDesignSections(workspace: CADRibbonWorkspaceDefinition): CADRibbonWorkspaceDefinition {
  if (!designTabs.has(workspace.id)) return workspace;
  const groups = workspace.groups;
  const create = groups.filter(group => group.label === "Create").flatMap(group => group.tools);
  const modify = groups.filter(group => ["Modify", "Repair", "Finish"].includes(group.label)).flatMap(group => group.tools);
  for (const group of groups.filter(group => ["Advanced Shape", "Transform"].includes(group.label))) {
    for (const tool of group.tools) {
      (tool.id === "solid-draft" || group.label === "Transform" && tool.id !== "solid-mirror" ? modify : create).push(tool);
    }
  }
  const common = (label: string, source: CADToolGroupDefinition): CADToolGroupDefinition => ({
    ...source, id: `${workspace.id}-${label.toLowerCase()}`, label,
  });
  return { ...workspace, groups: [
    { id: `${workspace.id}-create`, label: "Create", tools: create },
    { id: `${workspace.id}-modify`, label: "Modify", tools: modify },
    common("Construct", solidWorkspace.groups.find(group => group.id === "solid-reference")!),
    common("Inspect", solidWorkspace.groups.find(group => group.id === "solid-analysis")!),
    common("Insert", homeWorkspace.groups[0]),
    common("Select", homeWorkspace.groups[1]),
  ] };
}
