/** Read-only configurations from the existing assembly presentation, never demo data. */
import { useSyncExternalStore } from "react";
import { InspectorSection, PropertyGrid, type TreeNode } from "@aether/ui";
import { cadAssemblyWorkspace } from "../../cad-assembly-workspace-store";
import "../CADInspector.css";

function configurationRows(nodes: readonly TreeNode[]): readonly TreeNode[] {
  for (const node of nodes) {
    if (node.id === "presentation/configurations") return node.children ?? [];
    const found = configurationRows(node.children ?? []);
    if (found.length) return found;
  }
  return [];
}

export function ConfigurationsPanel() {
  const assembly = useSyncExternalStore(cadAssemblyWorkspace.subscribe, cadAssemblyWorkspace.snapshot, cadAssemblyWorkspace.snapshot);
  const ready = assembly.loadState === "ready" && assembly.data;
  const configurations = ready ? configurationRows(ready.treeNodes) : [];
  return <section className="cad-property-sheet" data-panel="configurations">
    <InspectorSection title="Saved configurations">
      <PropertyGrid ariaLabel="Assembly configurations" sections={configurations.length ? [{
        id: "configurations", label: "Assembly", properties: configurations.map(row => ({
          id: row.id, label: row.label, readOnly: true, editor: <output>{row.badge ?? "Saved"}</output>,
        })),
      }] : []} emptyState={ready ? "This assembly has no saved configurations." : "Open an assembly to inspect its saved configurations."} />
      <p className="cad-form-note">Configuration creation, editing and activation are not connected yet. Part configurations are not available.</p>
    </InspectorSection>
  </section>;
}
