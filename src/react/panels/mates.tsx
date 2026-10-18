/** Mates — the assembly mate list, its actions menu and the legacy proof. */
import { type BOMRowProjection } from "../../cad-assembly-bridge";
import { cadAssemblyWorkspace } from "../../cad-assembly-workspace-store";
import { cadCommands } from "../../cad-command-registry";
import { cadPresentation } from "../../cad-presentation-store";
import { cadWorkspace } from "../../cad-workspace-store";
import { AetherIcon, InspectorSection, DataTable, type DataTableColumn, EmptyState, ErrorState, ListBox, MenuButton, type MenuItem, SegmentedControl, Tabs, TreePanel } from "@aether/ui";
import { useSyncExternalStore } from "react";

function MateActionsMenu() {
  const commands = useSyncExternalStore(
    cadCommands.subscribe,
    cadCommands.snapshot,
    cadCommands.snapshot,
  );
  const assembly = useSyncExternalStore(
    cadAssemblyWorkspace.subscribe,
    cadAssemblyWorkspace.snapshot,
    cadAssemblyWorkspace.snapshot,
  );
  const ready = assembly.loadState === "ready" && assembly.data !== null;
  const canSave = ready && assembly.data.commandAvailability.find((item) => item.id === "save-workspace")?.enabled === true;

  const items: MenuItem[] = [
    { id: "new-assembly", label: "New Assembly", icon: <AetherIcon name="plus" /> },
    { id: "open-assembly", label: "Open Assembly…", icon: <AetherIcon name="open-external" /> },
    {
      id: "insert-component",
      label: "Insert Component…",
      icon: <AetherIcon name="plus" />,
      disabled: !commands["assembly-insert-component"].enabled,
      disabledReason: "Open an editable canonical Assembly first.",
    },
    {
      id: "add-connector",
      label: "Add Manual Connector…",
      icon: <AetherIcon name="keyframe" />,
      disabled: !commands["assembly-add-connector"].enabled,
      disabledReason: "Select exactly one editable Assembly component first.",
    },
    {
      id: "create-mate",
      label: "Create Mate…",
      icon: "⛓",
      disabled: !commands["assembly-create-mate"].enabled,
      disabledReason: "Add connectors to at least two active component instances.",
    },
    {
      id: "create-relation",
      label: "Create DOF Relation…",
      icon: "⚙",
      disabled: !commands["assembly-create-relation"].enabled,
      disabledReason: "Create at least two compatible free revolute or prismatic DOFs.",
    },
    {
      id: "set-mate-dof-value",
      label: "Set Selected Mate Value…",
      icon: <AetherIcon name="revolute" />,
      disabled: !commands["assembly-set-mate-dof-value"].enabled,
      disabledReason: "Select one active revolute or prismatic mate with a free DOF.",
    },
    {
      id: "edit-mate-dof-limits",
      label: "Edit Selected Mate Limits…",
      icon: "↔",
      disabled: !commands["assembly-edit-mate-dof-limits"].enabled,
      disabledReason: "Select one active revolute or prismatic mate with a free DOF.",
    },
    {
      id: "toggle-mate-suppressed",
      label: commands["assembly-toggle-mate-suppressed"].active ? "Restore Selected Mate" : "Suppress Selected Mate",
      icon: "◌",
      disabled: !commands["assembly-toggle-mate-suppressed"].enabled,
      disabledReason: "Select exactly one persistent Assembly mate.",
    },
    {
      id: "remove-mate",
      label: "Remove Selected Mate",
      icon: <AetherIcon name="close" />,
      danger: true,
      disabled: !commands["assembly-remove-mate"].enabled,
      disabledReason: "Select exactly one persistent Assembly mate.",
    },
    {
      id: "save-assembly",
      label: "Save Assembly…",
      icon: <AetherIcon name="import" />,
      disabled: !canSave,
      disabledReason: ready ? "Core has disabled workspace persistence." : "Open a canonical Assembly first.",
    },
  ];
  return (
    <MenuButton
      label="Mate actions"
      items={items}
      onSelect={(id) => {
        if (id === "new-assembly") cadPresentation.dispatch({ type: "create-assembly-workspace", name: "Untitled Assembly" });
        if (id === "open-assembly") cadPresentation.dispatch({ type: "open-assembly-workspace" });
        if (id === "insert-component") cadCommands.execute("assembly-insert-component");
        if (id === "add-connector") cadCommands.execute("assembly-add-connector");
        if (id === "create-mate") cadCommands.execute("assembly-create-mate");
        if (id === "create-relation") cadCommands.execute("assembly-create-relation");
        if (id === "set-mate-dof-value") cadCommands.execute("assembly-set-mate-dof-value");
        if (id === "edit-mate-dof-limits") cadCommands.execute("assembly-edit-mate-dof-limits");
        if (id === "toggle-mate-suppressed") cadCommands.execute("assembly-toggle-mate-suppressed");
        if (id === "remove-mate") cadCommands.execute("assembly-remove-mate");
        if (id === "save-assembly") cadPresentation.dispatch({ type: "save-assembly-workspace" });
      }}
    >
      •••
    </MenuButton>
  );
}

const assemblyTabs = [
  { id: "structure", label: "Structure" },
  { id: "constraints", label: "Mates" },
  { id: "bom", label: "BOM" },
] as const;

const bomColumns: readonly DataTableColumn<BOMRowProjection>[] = [
  { id: "part-number", header: "Part #", cell: (row) => row.part_number ?? "—", sortValue: (row) => row.part_number, sortable: true, pinned: true, width: 86 },
  { id: "name", header: "Name", cell: (row) => row.name, sortValue: (row) => row.name, sortable: true, width: 130 },
  { id: "quantity", header: "Qty", cell: (row) => String(row.quantity), sortValue: (row) => row.quantity, sortable: true, align: "end", width: 55 },
  { id: "material", header: "Material", cell: (row) => row.material_name ?? "—", sortValue: (row) => row.material_name, sortable: true, width: 95 },
];

function LegacyMateProof() {
  const workspace = useSyncExternalStore(
    cadWorkspace.subscribe,
    cadWorkspace.snapshot,
    cadWorkspace.snapshot,
  );
  return (
    <>
      <aside className="assembly-session-notice" role="note">
        <strong>Session-only Part proof</strong>
        <span>These Part-viewer connectors remain separate from a saved Assembly. Create or open an Assembly to use persistent mates, solve, and BOM.</span>
      </aside>
      <div className="panel-heading"><span>MATE CONNECTORS</span><span id="connector-count">{workspace.connectorItems.length}</span></div>
      <div id="connectors-list" className="connectors-list">
        <ListBox
          ariaLabel="Mate connectors"
          items={workspace.connectorItems}
          selectedIDs={workspace.selectedConnectorIDs}
          onSelect={(ids) => {
            const id = ids[0];
            if (id) cadWorkspace.dispatch({ type: "select-connector", id });
          }}
          onAction={(id, actionID) => cadWorkspace.dispatch({ type: "connector-action", id, actionID })}
          emptyState="No connector anchors yet."
        />
      </div>
      <div className="panel-heading section-heading"><span>FASTENED MATES</span><span id="mate-count">{workspace.mateItems.length}</span></div>
      <div id="mates-list" className="mates-list">
        <ListBox ariaLabel="Fastened mates" items={workspace.mateItems} selectedIDs={new Set()} selectionMode="none" emptyState="No mates yet." />
      </div>
    </>
  );
}

export function MatesPanel({ active }: { active: boolean }) {
  const assembly = useSyncExternalStore(
    cadAssemblyWorkspace.subscribe,
    cadAssemblyWorkspace.snapshot,
    cadAssemblyWorkspace.snapshot,
  );
  const ready = assembly.loadState === "ready" && assembly.data !== null;
  const body = (() => {
    if (assembly.loadState === "loading") {
      return <EmptyState compact icon="…" title="Loading Assembly" description={assembly.message} />;
    }
    if (assembly.loadState === "error") {
      return <ErrorState compact title="Assembly unavailable" description={assembly.message} />;
    }
    if (!ready) {
      if (assembly.activeTab === "constraints") return <LegacyMateProof />;
      return <EmptyState
        compact
        icon={assembly.activeTab === "structure" ? "▱" : "▦"}
        title={assembly.activeTab === "structure" ? "Persistent Assembly graph unavailable" : "BOM unavailable"}
        description={assembly.message}
      />;
    }
    if (assembly.activeTab === "structure") {
      return <>
        <div className="canonical-assembly-tree">
          <TreePanel
            ariaLabel="Assembly structure"
            nodes={assembly.data.treeNodes}
            selectedIDs={assembly.selectedEntityIDs}
            expandedIDs={assembly.expandedEntityIDs}
            filter={assembly.filter} filterLabel="Filter Assembly structure"
            onFilterChange={(filter) => cadAssemblyWorkspace.dispatch({ type: "set-filter", filter })}
            onSelect={(ids, mode) => cadAssemblyWorkspace.dispatch({ type: "select-entities", ids, mode })}
            onToggle={(id, expanded) => cadAssemblyWorkspace.dispatch({ type: "toggle-entity", id, expanded })}
            emptyState="No matching Assembly items"
          />
        </div>
      </>;
    }
    if (assembly.activeTab === "bom") {
      return <div className="canonical-bom-table">
        <SegmentedControl
          ariaLabel="BOM structure"
          value={assembly.data.summary.bomMode ?? "hierarchical"}
          options={[
            { id: "hierarchical", label: "Hierarchical" },
            { id: "flattened", label: "Flattened" },
          ]}
          onChange={(mode) => cadAssemblyWorkspace.dispatch({
            type: "select-bom-mode",
            mode: mode as "hierarchical" | "flattened",
          })}
        />
        <DataTable
          ariaLabel="Assembly bill of materials"
          rows={assembly.data.bomRows}
          rowID={(row) => row.row_id}
          columns={bomColumns}
          selectedIDs={assembly.selectedBOMRowIDs}
          onSelect={(ids, mode) => cadAssemblyWorkspace.dispatch({ type: "select-bom-rows", ids, mode })}
          filterText={(row) => `${row.part_number ?? ""} ${row.name} ${row.material_name ?? ""}`}
          emptyState="Core returned no BOM rows for this Assembly."
          virtualizeThreshold={100}
          height={430}
        />
      </div>;
    }
    return <div className="canonical-assembly-constraints">
      <InspectorSection defaultOpen title="Connectors">
      <ListBox ariaLabel="Canonical mate connectors" items={assembly.data.connectorItems} selectedIDs={assembly.selectedEntityIDs} onSelect={(ids, mode) => cadAssemblyWorkspace.dispatch({ type: "select-entities", ids, mode })} emptyState="No connector definitions." /></InspectorSection>
      <InspectorSection defaultOpen title="Mates">
      <ListBox ariaLabel="Canonical mates" items={assembly.data.mateItems} selectedIDs={assembly.selectedEntityIDs} onSelect={(ids, mode) => cadAssemblyWorkspace.dispatch({ type: "select-entities", ids, mode })} emptyState="No mates." /></InspectorSection>
      <InspectorSection defaultOpen title="Relations">
      <ListBox ariaLabel="Canonical relations" items={assembly.data.relationItems} selectedIDs={assembly.selectedEntityIDs} onSelect={(ids, mode) => cadAssemblyWorkspace.dispatch({ type: "select-entities", ids, mode })} emptyState="No relations." /></InspectorSection>
      {assembly.data.problemItems.length > 0 ? <InspectorSection defaultOpen title="Diagnostics"><ListBox ariaLabel="Assembly diagnostics" items={assembly.data.problemItems} selectedIDs={assembly.selectedEntityIDs} onSelect={(ids, mode) => cadAssemblyWorkspace.dispatch({ type: "select-entities", ids, mode })} /></InspectorSection> : null}
    </div>;
  })();
  return (
    <section className={`browser-panel${active ? " active" : ""}`} data-panel="mates">
      <header className="browser-title"><div><strong>Assembly</strong><small>{ready ? assembly.message : "Canonical graph · session proof"}</small></div><MateActionsMenu /></header>
      <div className="assembly-workbench-tabs"><Tabs tabs={assemblyTabs} activeID={assembly.activeTab} onSelect={(id) => cadAssemblyWorkspace.dispatch({ type: "select-tab", tab: id as typeof assembly.activeTab })} /></div>
      <div className="assembly-workbench-body">{body}</div>
    </section>
  );
}
