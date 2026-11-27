/** Live configurations panel: switches active Part configurations directly in the right sidebar
 *  without requiring a popup, opens the full configuration editor, and shows saved assembly configs. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, EmptyState, FieldRow, InspectorActions, InspectorSection, PropertyGrid, SelectField, type TreeNode } from "@aether/ui";
import {
  activateConfiguration,
  configurationColumnKey,
  configurationMatches,
  updatePartDocumentVariables,
  type ConfigurationColumn,
} from "@aether/core/document";
import { cadAssemblyWorkspace } from "../../core/stores/cad-assembly-workspace-store";
import { cadPresentation } from "../../core/stores/cad-presentation-store";
import { documentParametersBridge } from "./parameters";
import { CommandButton } from "./shared";
import "../CADInspector.css";

function configurationRows(nodes: readonly TreeNode[]): readonly TreeNode[] {
  for (const node of nodes) {
    if (node.id === "presentation/configurations") return node.children ?? [];
    const found = configurationRows(node.children ?? []);
    if (found.length) return found;
  }
  return [];
}

function columnDisplayLabel(column: ConfigurationColumn, featureName: (id: string) => string): string {
  if (column.kind === "param") return `#${column.name}`;
  if (column.kind === "material") return `Material (${column.bodyId})`;
  return featureName(column.featureId);
}

export function ConfigurationsPanel() {
  const assembly = useSyncExternalStore(cadAssemblyWorkspace.subscribe, cadAssemblyWorkspace.snapshot, cadAssemblyWorkspace.snapshot);
  const presentation = useSyncExternalStore(cadPresentation.subscribe, cadPresentation.snapshot, cadPresentation.snapshot);
  const { doc, onApply } = useSyncExternalStore(
    documentParametersBridge.subscribe,
    documentParametersBridge.snapshot,
    documentParametersBridge.snapshot,
  );

  const table = doc?.configurations;
  const rows = table?.rows ?? [];
  const columns = table?.columns ?? [];
  const rules = table?.rules ?? [];
  const [selectedRow, setSelectedRow] = useState(table?.activeRow ?? rows[0]?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (table?.activeRow && rows.some((r) => r.name === table.activeRow)) {
      setSelectedRow(table.activeRow);
    } else if (!rows.some((r) => r.name === selectedRow)) {
      setSelectedRow(rows[0]?.name ?? "");
    }
  }, [table?.activeRow, rows.length]);

  const activeRowObj = rows.find((r) => r.name === selectedRow);
  const matchesDesign = doc && table?.activeRow ? configurationMatches(doc) : true;
  const featureName = (id: string) => doc?.features.find((f) => f.id === id)?.name ?? id;

  const handleActivate = async (rowName: string) => {
    if (!doc || !rowName) return;
    setBusy(true);
    setError("");
    try {
      const activated = activateConfiguration(doc, rowName).document;
      const regenerated = activated.variables?.length
        ? await updatePartDocumentVariables({ ...activated, variables: doc.variables }, activated.variables)
        : activated;
      await onApply?.(regenerated);
      documentParametersBridge.bind(regenerated, onApply);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const ready = assembly.loadState === "ready" && assembly.data;
  const assemblyConfigs = ready ? configurationRows(ready.treeNodes) : [];

  return (
    <section className="cad-property-sheet" data-panel="configurations" aria-label="Configurations">
      <InspectorSection defaultOpen title="Part configurations">
        {rows.length > 0 ? (
          <>
            <FieldRow label="Active row" htmlFor="sidebar-config-row">
              <SelectField
                id="sidebar-config-row"
                aria-label="Part configuration row"
                value={selectedRow}
                disabled={busy}
                options={rows.map((r) => ({
                  value: r.name,
                  label: r.name === table?.activeRow ? `${r.name} (active)` : r.name,
                }))}
                onChange={(e) => setSelectedRow(e.target.value)}
              />
            </FieldRow>

            <div className="cad-spec-card">
              <div className="cad-spec-header">
                <span className="cad-inspector-card-title">{activeRowObj?.name ?? "Configuration"}</span>
                {table?.activeRow === selectedRow && (
                  <span className={`cad-pill ${matchesDesign ? "cad-pill--ok" : "cad-pill--warn"}`}>
                    {matchesDesign ? "Matches" : "Modified"}
                  </span>
                )}
                {rules.length > 0 && <span className="cad-pill">{rules.length} rule{rules.length === 1 ? "" : "s"}</span>}
              </div>
              {activeRowObj && columns.length > 0 && (
                <dl className="cad-spec-grid">
                  {columns.map((col) => {
                    const key = configurationColumnKey(col);
                    const val = activeRowObj.values[key];
                    const formatted =
                      col.kind === "suppress"
                        ? val ? "Suppressed" : "Active"
                        : String(val ?? "—");
                    return (
                      <div key={key} style={{ display: "contents" }}>
                        <dt>{columnDisplayLabel(col, featureName)}</dt>
                        <dd>{formatted}</dd>
                      </div>
                    );
                  })}
                </dl>
              )}
            </div>

            {error && <p role="alert" className="cad-callout cad-callout--error">{error}</p>}

            <InspectorActions>
              <Button
                primary
                disabled={busy || !selectedRow}
                onClick={() => void handleActivate(selectedRow)}
              >
                {busy ? "Activating…" : "Activate row"}
              </Button>
              <CommandButton primary={false} id="open-part-configurations" command="show-configurations">
                Manage table…
              </CommandButton>
            </InspectorActions>
          </>
        ) : (
          <>
            <EmptyState
              title="No configurations"
              description={
                presentation.partOpen
                  ? "Create named rows over document variables, body materials, and feature suppressions with ordered rules."
                  : "Open a Part to create, preview, and activate configurations."
              }
            />
            <InspectorActions>
              <CommandButton id="open-part-configurations" className="author-button" command="show-configurations">
                Manage Part Configurations
              </CommandButton>
            </InspectorActions>
          </>
        )}
      </InspectorSection>

      <InspectorSection defaultOpen={Boolean(assemblyConfigs.length)} title="Saved assembly configurations">
        <PropertyGrid
          ariaLabel="Assembly configurations"
          sections={assemblyConfigs.length ? [{
            id: "configurations",
            label: "Assembly",
            properties: assemblyConfigs.map((row) => ({
              id: row.id,
              label: row.label,
              readOnly: true,
              editor: <output>{row.badge ?? "Saved"}</output>,
            })),
          }] : []}
          emptyState={ready ? "This assembly has no saved configurations." : "Open an assembly to inspect its saved configurations."}
        />
      </InspectorSection>
    </section>
  );
}
