import { useEffect, useState } from "react";
import { Inspector, InspectorSection } from "@aether/ui";
import "./CADInspector.css";
import {
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  ErrorState,
  ListBox,
  MenuButton,
  PropertyGrid,
  SearchField,
  Tabs,
  TreePanel,
  type DataTableColumn,
  type ListBoxItem,
  type MenuItem,
} from "@aether/ui";
import type { DrawingBOMRow, DrawingPresentationCommandID } from "../core/cad-drawing-presentation";
import type {
  CADDrawingWorkspaceAction,
  CADDrawingWorkspaceSnapshot,
} from "../core/stores/cad-drawing-workspace-store";
import { DrawingSheetCanvas } from "./DrawingSheetCanvas";
import {
  defaultViewBox,
  DRAWING_PLACEMENT_TOOLS,
  zoomViewBoxAt,
  type DrawingPlacementTool,
  type SheetViewBox,
} from "../drawing/canvas-interaction";

export interface DrawingWorkspaceProps {
  readonly snapshot: CADDrawingWorkspaceSnapshot;
  readonly onAction: (action: CADDrawingWorkspaceAction) => void;
  readonly onCommand: (command: DrawingPresentationCommandID) => void;
  readonly commandsConnected?: boolean;
  readonly editable?: boolean;
  readonly onMoveView?: (viewId: string, deltaMm: [number, number]) => void;
  readonly onMoveAnnotation?: (annotationId: string, deltaMm: [number, number]) => void;
  readonly onPlaceAnnotation?: (
    tool: Exclude<DrawingPlacementTool, "select">,
    pointsMm: [number, number][],
    snappedViewId?: string,
  ) => void;
  readonly onExit?: () => void;
  readonly className?: string;
}

const drawingTabs = [
  { id: "sheets", label: "Sheets" },
  { id: "annotations", label: "Annotations" },
  { id: "bom", label: "BOM" },
  { id: "styles", label: "Styles" },
] as const;

const bomColumns: readonly DataTableColumn<DrawingBOMRow>[] = [
  { id: "item", header: "Item", cell: (row) => row.item_number, sortValue: (row) => row.item_number, sortable: true, pinned: true, width: 58 },
  { id: "part", header: "Part definition", cell: (row) => row.part_definition_id, sortValue: (row) => row.part_definition_id, sortable: true, width: 142 },
  { id: "quantity", header: "Qty", cell: (row) => String(row.quantity), sortValue: (row) => row.quantity, sortable: true, align: "end", width: 55 },
];

const commandLabels: Record<DrawingPresentationCommandID, string> = {
  "add-sheet": "Add sheet",
  "add-view": "Base view",
  "add-standard-views": "4-View",
  "add-section": "Section view",
  "add-annotation": "Annotation",
  "import-dimensions": "Import dims",
  "add-bom": "BOM table",
  "audit-drawing": "Audit",
  "rebuild-drawing": "Rebuild",
  "save-workspace": "Save",
  "export-pdf": "PDF",
  "export-pdf-all": "PDF · All sheets",
  "export-dxf": "DXF",
  "export-svg": "SVG",
};

function filterItems(items: readonly ListBoxItem[], filter: string): readonly ListBoxItem[] {
  const query = filter.trim().toLocaleLowerCase();
  if (!query) return items;
  return items.filter((item) => `${item.label} ${item.description ?? ""} ${item.badge ?? ""}`.toLocaleLowerCase().includes(query));
}

function drawingResultCount(snapshot: CADDrawingWorkspaceSnapshot): number {
  const data = snapshot.data!;
  const query = snapshot.filter.trim().toLocaleLowerCase();
  if (snapshot.activeTab === "annotations") return filterItems(data.annotationItems, snapshot.filter).length;
  if (snapshot.activeTab === "styles") return filterItems(data.styleItems, snapshot.filter).length;
  if (snapshot.activeTab === "bom") return data.bomRows.filter((row) => !query || `${row.item_number} ${row.part_definition_id} ${row.quantity}`.toLocaleLowerCase().includes(query)).length;
  let count = 0;
  const visit = (nodes: typeof data.treeNodes) => nodes.forEach((node) => {
    if (!query || `${node.label} ${node.badge ?? ""}`.toLocaleLowerCase().includes(query)) count += 1;
    if (node.children) visit(node.children);
  });
  visit(data.treeNodes);
  return count;
}

function ReadOnlyDrawingProperties({ snapshot }: { snapshot: CADDrawingWorkspaceSnapshot }) {
  return <PropertyGrid
    ariaLabel="Drawing properties"
    sections={(snapshot.data?.inspectorSections ?? []).map((section) => ({
      ...section,
      properties: section.properties.map((property) => ({
        ...property,
        editor: <output>{property.value}</output>,
        readOnly: true,
      })),
    }))}
    emptyState="Select a sheet, view, annotation, BOM table, or exact primitive."
  />;
}

function DependencyState({ snapshot }: { snapshot: CADDrawingWorkspaceSnapshot }) {
  if (snapshot.loadState === "error") {
    return <ErrorState title="Drawing unavailable" description={snapshot.message} />;
  }
  if (snapshot.loadState === "loading") {
    return <EmptyState icon="…" title="Building drawing" description={snapshot.message} />;
  }
  return <EmptyState
    icon="▤"
    title="Open or create a drawing"
    description={snapshot.message}
  />;
}

function CommandButton({
  id,
  snapshot,
  onCommand,
  commandsConnected,
}: {
  id: DrawingPresentationCommandID;
  snapshot: CADDrawingWorkspaceSnapshot;
  onCommand: (command: DrawingPresentationCommandID) => void;
  commandsConnected: boolean;
}) {
  const availability = snapshot.data?.commandAvailability.find((item) => item.id === id);
  const enabled = commandsConnected && availability?.enabled === true;
  const disabledReason = commandsConnected
    ? availability?.disabledReason ?? "Core capability unavailable."
    : "Drawing command transport is not connected.";
  return <Button
    data-drawing-command={id}
    disabled={!enabled}
    title={enabled ? undefined : disabledReason}
    onClick={() => onCommand(id)}
  >{commandLabels[id]}</Button>;
}

function DrawingCommandBar({ snapshot, onCommand, commandsConnected = true }: Pick<DrawingWorkspaceProps, "snapshot" | "onCommand" | "commandsConnected">) {
  const exportItems: MenuItem[] = (["export-pdf", "export-pdf-all", "export-dxf", "export-svg"] as const).map((id) => {
    const availability = snapshot.data?.commandAvailability.find((item) => item.id === id);
    return {
      id,
      label: commandLabels[id],
      disabled: !commandsConnected || availability?.enabled !== true,
      disabledReason: commandsConnected ? availability?.disabledReason : "Drawing command transport is not connected.",
    };
  });
  return <header className="cad-drawing-commandbar" aria-label="Drawing commands">
    <div className="cad-drawing-command-group" aria-label="Sheet and view commands">
      <CommandButton id="add-sheet" snapshot={snapshot} onCommand={onCommand} commandsConnected={commandsConnected} />
      <CommandButton id="add-view" snapshot={snapshot} onCommand={onCommand} commandsConnected={commandsConnected} />
      <CommandButton id="add-standard-views" snapshot={snapshot} onCommand={onCommand} commandsConnected={commandsConnected} />
      <CommandButton id="add-section" snapshot={snapshot} onCommand={onCommand} commandsConnected={commandsConnected} />
    </div>
    <div className="cad-drawing-command-group" aria-label="Annotation commands">
      <CommandButton id="add-annotation" snapshot={snapshot} onCommand={onCommand} commandsConnected={commandsConnected} />
      <CommandButton id="import-dimensions" snapshot={snapshot} onCommand={onCommand} commandsConnected={commandsConnected} />
      <CommandButton id="add-bom" snapshot={snapshot} onCommand={onCommand} commandsConnected={commandsConnected} />
      <CommandButton id="audit-drawing" snapshot={snapshot} onCommand={onCommand} commandsConnected={commandsConnected} />
    </div>
    <div className="cad-drawing-command-group cad-drawing-command-group--end" aria-label="Document commands">
      <CommandButton id="rebuild-drawing" snapshot={snapshot} onCommand={onCommand} commandsConnected={commandsConnected} />
      <CommandButton id="save-workspace" snapshot={snapshot} onCommand={onCommand} commandsConnected={commandsConnected} />
      <MenuButton label="Export Drawing" items={exportItems} onSelect={(id) => onCommand(id as DrawingPresentationCommandID)}>Export</MenuButton>
    </div>
  </header>;
}

function DrawingBrowser({ snapshot, onAction }: Pick<DrawingWorkspaceProps, "snapshot" | "onAction">) {
  const data = snapshot.data!;
  const select = (ids: readonly string[], mode: "single" | "toggle" | "range") => onAction({ type: "select-entities", ids, mode });
  let content;
  switch (snapshot.activeTab) {
    case "sheets":
      content = <TreePanel
        ariaLabel="Drawing sheets and views"
        nodes={data.treeNodes}
        selectedIDs={snapshot.selectedEntityIDs}
        expandedIDs={snapshot.expandedEntityIDs}
        filter={snapshot.filter} filterLabel="Filter Drawing browser" filterResultCount={drawingResultCount(snapshot)}
        onFilterChange={(filter) => onAction({ type: "set-filter", filter })}
        onSelect={select}
        onToggle={(id, expanded) => onAction({ type: "toggle-entity", id, expanded })}
        emptyState="No matching Drawing entities."
        virtualizeThreshold={100}
        height={560}
      />;
      break;
    case "annotations":
      content = <ListBox
        ariaLabel="Drawing annotations"
        items={data.annotationItems} filter={snapshot.filter} onFilterChange={(filter) => onAction({ type: "set-filter", filter })}
        selectedIDs={snapshot.selectedEntityIDs}
        onSelect={select}
        emptyState="No matching annotations."
        virtualizeThreshold={100}
        height={560}
      />;
      break;
    case "bom":
      content = <DataTable
        ariaLabel="Drawing bill of materials"
        rows={data.bomRows}
        rowID={(row) => row.selection_id}
        columns={bomColumns}
        selectedIDs={snapshot.selectedEntityIDs}
        onSelect={select}
        filter={snapshot.filter}
        filterText={(row) => `${row.item_number} ${row.part_definition_id} ${row.quantity}`}
        emptyState="No matching Drawing BOM rows."
        virtualizeThreshold={100}
        height={560}
      />;
      break;
    case "styles":
      content = <ListBox
        ariaLabel="Drawing styles"
        items={data.styleItems} filter={snapshot.filter} onFilterChange={(filter) => onAction({ type: "set-filter", filter })}
        selectedIDs={snapshot.selectedEntityIDs}
        onSelect={select}
        emptyState="No matching Drawing styles."
        virtualizeThreshold={100}
        height={560}
      />;
      break;
  }
  return <aside className="cad-drawing-browser" aria-label="Drawing browser">
    <Tabs tabs={drawingTabs} activeID={snapshot.activeTab} onSelect={(id) => onAction({ type: "select-tab", tab: id as CADDrawingWorkspaceSnapshot["activeTab"] })} />
    {snapshot.activeTab === "bom" && <div className="cad-drawing-filter">
      <SearchField ariaLabel="Filter Drawing browser" placeholder={`Filter ${snapshot.activeTab}`} value={snapshot.filter} onQueryChange={(filter) => onAction({ type: "set-filter", filter })} resultCount={drawingResultCount(snapshot)} />
    </div>}
    <div className="cad-drawing-browser-content">{content}</div>
  </aside>;
}

function DrawingInspector({ snapshot, onAction }: Pick<DrawingWorkspaceProps, "snapshot" | "onAction">) {
  const problems = snapshot.data?.problemItems ?? [];
  return <aside className="cad-drawing-inspector cad-drawing-property-sheet" aria-label="Drawing inspector"><Inspector>
    <ReadOnlyDrawingProperties snapshot={snapshot} />
    <InspectorSection title={`Problems (${problems.length})`}>
      <ListBox
        ariaLabel="Drawing diagnostics"
        items={problems}
        selectedIDs={snapshot.selectedEntityIDs}
        onSelect={(ids, mode) => onAction({ type: "select-entities", ids, mode })}
        emptyState="No Drawing problems."
        virtualizeThreshold={100}
        height={180}
      />
    </InspectorSection>
  </Inspector></aside>;
}

function DrawingCanvas({
  snapshot,
  onAction,
  editable = false,
  onMoveView,
  onMoveAnnotation,
  onPlaceAnnotation,
}: Pick<DrawingWorkspaceProps, "snapshot" | "onAction" | "editable" | "onMoveView" | "onMoveAnnotation" | "onPlaceAnnotation">) {
  const projection = snapshot.projection!;
  const data = snapshot.data!;
  const sheet = projection.sheets.find((item) => item.id === data.activeSheetID);
  const [placementTool, setPlacementTool] = useState<DrawingPlacementTool>("select");
  const [viewBox, setViewBox] = useState<SheetViewBox | undefined>(undefined);

  useEffect(() => {
    setViewBox(undefined);
    setPlacementTool("select");
  }, [sheet?.id]);

  if (projection.revision !== data.revision) {
    return <ErrorState title="Drawing revision mismatch" description="The visible projection and presentation snapshot do not share one Core revision." />;
  }
  if (!sheet) {
    return <EmptyState icon="▤" title="No active sheet" description="Create or activate a sheet through the canonical Drawing engine." />;
  }
  if (sheet.revision !== projection.revision) {
    return <ErrorState title="Sheet revision mismatch" description="The active sheet is stale relative to the Drawing projection." />;
  }

  const activeVb = viewBox ?? defaultViewBox(sheet.width_mm, sheet.height_mm);
  const zoomPercent = Math.round((sheet.width_mm / Math.max(1, activeVb[2])) * 100);
  const centerMm: [number, number] = [activeVb[0] + activeVb[2] / 2, activeVb[1] + activeVb[3] / 2];
  const toolMeta = DRAWING_PLACEMENT_TOOLS.find((t) => t.id === placementTool) ?? DRAWING_PLACEMENT_TOOLS[0];
  const interactiveCanvas = editable && Boolean(onPlaceAnnotation || onMoveView || onMoveAnnotation);

  return <section className="cad-drawing-canvas" aria-label="Drawing sheet canvas">
    <header>
      <div><strong>{sheet.name}</strong><small>{sheet.width_mm} × {sheet.height_mm} mm · {sheet.projection_standard.replace("_", " ")}</small></div>
      <div className="cad-drawing-canvas-controls" aria-label="Sheet interaction controls">
        {interactiveCanvas && (
          <select
            className="cad-drawing-tool-select"
            aria-label="Canvas placement tool"
            value={placementTool}
            title={toolMeta.hint}
            onChange={(event) => setPlacementTool(event.target.value as DrawingPlacementTool)}
          >
            {DRAWING_PLACEMENT_TOOLS.map((tool) => (
              <option key={tool.id} value={tool.id}>{tool.label}</option>
            ))}
          </select>
        )}
        <div className="cad-drawing-zoom-controls" aria-label="Sheet zoom controls">
          <Button aria-label="Zoom out sheet" onClick={() => setViewBox(zoomViewBoxAt(activeVb, sheet.width_mm, sheet.height_mm, 1 / 1.25, centerMm))}>−</Button>
          <span className="cad-drawing-zoom-readout" data-zoom-percent={zoomPercent}>{zoomPercent}%</span>
          <Button aria-label="Zoom in sheet" onClick={() => setViewBox(zoomViewBoxAt(activeVb, sheet.width_mm, sheet.height_mm, 1.25, centerMm))}>+</Button>
          <Button aria-label="Fit sheet" onClick={() => setViewBox(undefined)}>Fit</Button>
        </div>
        <Checkbox
          checked={snapshot.showSnapPoints}
          label="Snap points"
          onChange={(event) => onAction({ type: "set-show-snap-points", visible: event.target.checked })}
        />
      </div>
    </header>
    <div className="cad-drawing-paper-stage">
      <DrawingSheetCanvas
        sheet={sheet}
        styles={projection.styles}
        selectedIDs={snapshot.selectedEntityIDs}
        showSnapPoints={snapshot.showSnapPoints}
        placementTool={placementTool}
        editable={editable}
        viewBox={viewBox}
        onViewBoxChange={setViewBox}
        onSelect={(id) => onAction({ type: "select-entities", ids: [id], mode: "single" })}
        onMoveView={onMoveView}
        onMoveAnnotation={onMoveAnnotation}
        onPlaceAnnotation={(tool, pts, snappedViewId) => {
          onPlaceAnnotation?.(tool, pts, snappedViewId);
        }}
      />
    </div>
  </section>;
}

export function DrawingWorkspace({
  snapshot,
  onAction,
  onCommand,
  commandsConnected = true,
  editable = false,
  onMoveView,
  onMoveAnnotation,
  onPlaceAnnotation,
  onExit,
  className,
}: DrawingWorkspaceProps) {
  const ready = snapshot.loadState === "ready" && snapshot.data !== null && snapshot.projection !== null;
  return <section className={["cad-drawing-workspace", onExit ? "cad-drawing-workspace--routed" : "", className].filter(Boolean).join(" ")} aria-label="Drawing workspace">
    {onExit ? <nav className="cad-drawing-routebar" aria-label="Drawing workspace navigation">
      <Button
        onClick={onExit}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onExit();
        }}
      >← 3D model</Button>
      <div><strong>Drawing</strong><small>Part sheets and annotations</small></div>
    </nav> : null}
    {!ready ? <div className="cad-drawing-dependency-state"><DependencyState snapshot={snapshot} /></div> : <>
      <DrawingCommandBar snapshot={snapshot} onCommand={onCommand} commandsConnected={commandsConnected} />
      <div className="cad-drawing-workbench">
        <DrawingBrowser snapshot={snapshot} onAction={onAction} />
        <DrawingCanvas
          snapshot={snapshot}
          onAction={onAction}
          editable={editable}
          onMoveView={onMoveView}
          onMoveAnnotation={onMoveAnnotation}
          onPlaceAnnotation={onPlaceAnnotation}
        />
        <DrawingInspector snapshot={snapshot} onAction={onAction} />
      </div>
      <footer className="cad-drawing-status" role="status" aria-live="polite">
        <span>{snapshot.message}</span>
        <span>{snapshot.data!.summary.sheetCount} sheets · {snapshot.data!.summary.viewCount} views · {snapshot.data!.summary.primitiveCount} projected primitives</span>
        <span>{snapshot.data!.summary.rebuildStatus.replace("_", " ")}</span>
      </footer>
    </>}
  </section>;
}
