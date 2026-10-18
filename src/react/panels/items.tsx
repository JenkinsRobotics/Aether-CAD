/** Items — the feature tree, the left rail's main panel. */
import { cadPresentation } from "../../cad-presentation-store";
import { cadWorkspace } from "../../cad-workspace-store";
import { AetherIcon, featureTreeMenuItems, TreePanel, TreePanelSplit, type TreeControl } from "@aether/ui";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { adjacentFeature, itemTreePresentation } from "./item-tree";
import "./items.css";
import { cadFeatureActions, cadTreeCommand, cadHistoryCount } from "./feature-tree-commands";
import { CADPartsPanel } from "./parts";
import { findTreeNode } from "./shared";

export function ItemsPanel({ active, onShowAppearance = () => { cadPresentation.dispatch({ type: "select-panel", panel: "visualization" }); } }: { active: boolean; onShowAppearance?: () => void }) {
  const workspace = useSyncExternalStore(
    cadWorkspace.subscribe,
    cadWorkspace.snapshot,
    cadWorkspace.snapshot,
  );
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState("all");
  const presentation = useSyncExternalStore(
    cadPresentation.subscribe,
    cadPresentation.snapshot,
    cadPresentation.snapshot,
  );
  const filterRef = useRef<HTMLInputElement>(null);
  const nodes = useMemo(() => itemTreePresentation(workspace.itemNodes), [workspace.itemNodes]);
  const bodies = useMemo(() => itemTreePresentation(workspace.bodyNodes ?? []), [workspace.bodyNodes]);
  // Folders and collection headings have no geometric counterpart. Keep their
  // tree-only selection here; any external geometry selection supersedes it.
  const [branchSelection, setBranchSelection] = useState<{ id: string; geometryKey: string } | null>(null);
  const geometryKey = [...workspace.selectedItemIDs].sort().join("\n");
  const branch = branchSelection && branchSelection.geometryKey === geometryKey
    ? findTreeNode([...nodes, ...bodies], branchSelection.id) : null;
  if (branchSelection && !branch) setBranchSelection(null);
  const selectedIDs = branch ? new Set([branch.id]) : workspace.selectedItemIDs;
  const selectRows = (ids: readonly string[], mode: "single" | "toggle" | "range" = "single") => {
    const rows = ids.filter((id) => id !== "rollback-bar");
    const id = rows[0];
    if (!id) return;
    if (id.startsWith("folder/") || id === "reference-folder" || id.startsWith("bodies/")) {
      setBranchSelection({ id, geometryKey });
    } else {
      setBranchSelection(null);
      cadWorkspace.dispatch({ type: "select-item", id, ids: rows, mode });
    }
  };
  const selected = [...selectedIDs].map((id) => findTreeNode([...nodes, ...bodies], id)).find(Boolean);
  const dispatch = (id: string, actionID: string) => { cadWorkspace.dispatch({ type: "item-action", id, actionID }); };
  const feature = selected?.id.startsWith("feature/") && !selected.id.startsWith("feature/body/");
  const folder = selected?.id.startsWith("folder/");
  const previous = selected && feature ? adjacentFeature(nodes, selected.id, -1) : undefined;
  const next = selected && feature ? adjacentFeature(nodes, selected.id, 1) : undefined;
  const controls: TreeControl[] = [
    { id: "folder", label: "New folder", icon: <AetherIcon name="collection-folder" />, disabled: !presentation.partOpen,
      onClick: () => { cadWorkspace.dispatch({ type: "create-folder", memberIDs: [...selectedIDs].filter((id) => id.startsWith("feature/") && !id.startsWith("feature/body/")) }); } },
    { id: "delete", label: folder ? "Dissolve folder" : "Delete feature", icon: <AetherIcon name="delete" />, disabled: !feature && !folder, shortcut: "Delete",
      onClick: () => selected && dispatch(selected.id, folder ? "folder-delete" : "delete-feature") },
    { id: "rename", label: "Rename item", icon: <AetherIcon name="notes" />, disabled: !selected || (!feature && !folder && !selected.id.startsWith("feature/body/")), shortcut: "F2",
      onClick: () => selected && dispatch(selected.id, folder ? "folder-rename" : feature ? "rename-feature" : "body-rename") },
    { id: "edit", label: "Edit feature", icon: <AetherIcon name="settings" />, disabled: !feature,
      onClick: () => selected && dispatch(selected.id, "edit-feature") },
    { id: "up", label: "Move feature up", icon: <AetherIcon name="chevron" style={{ transform: "rotate(-90deg)" }} />, disabled: !previous, separatorBefore: true,
      onClick: () => { if (selected && previous) cadWorkspace.dispatch({ type: "move-item", id: selected.id, targetID: previous.id, position: "before" }); } },
    { id: "down", label: "Move feature down", icon: <AetherIcon name="chevron" style={{ transform: "rotate(90deg)" }} />, disabled: !next,
      onClick: () => { if (selected && next) cadWorkspace.dispatch({ type: "move-item", id: selected.id, targetID: next.id, position: "after" }); } },
  ];
  const rawNodes = [...workspace.itemNodes, ...(workspace.bodyNodes ?? [])];
  const menuActions = (id: string) => {
    const node = findTreeNode(rawNodes, id);
    return node && id !== "rollback-bar" && id !== "reference-folder" ? cadFeatureActions(node, rawNodes, selectedIDs, workspace.rollbackIndex, presentation.partOpen, workspace.historyItems.filter(row => row.id.startsWith("history/feature/")).map(row => row.id.slice("history/feature/".length))) : [];
  };
  const menuItems = (id: string) => featureTreeMenuItems(menuActions(id));
  const runMenu = (id: string, commandID: string) => {
    const node = findTreeNode(rawNodes, id), action = menuActions(id).find(entry => entry.item.id === commandID);
    if (!node || !action || action.item.disabled) return;
    if (action.request.command === "appearance") { selectRows([id]); onShowAppearance(); return; }
    const command = cadTreeCommand(action.request, node);
    if (command) cadWorkspace.dispatch(command);
  };
  useEffect(() => {
    if (presentation.itemFilterFocusSerial > 0) filterRef.current?.focus();
  }, [presentation.itemFilterFocusSerial]);
  return (
    <section className={`browser-panel${active ? " active" : ""}`} data-panel="items" onKeyDownCapture={event=>{
      if (!(event.target instanceof HTMLElement) || !event.target.classList.contains("aui-feature-tree-rollback") || filter || category !== "all") return;
      const count=workspace.historyItems.filter(row=>row.id.startsWith("history/feature/")).length;
      const index=event.key==="ArrowUp"?workspace.rollbackIndex-1:event.key==="ArrowDown"?workspace.rollbackIndex+1:event.key==="Home"?0:event.key==="End"?count:null;
      if(index!==null){event.preventDefault();event.stopPropagation();cadWorkspace.dispatch({type:"rollback-to",index:Math.max(0,Math.min(count,index))});}
    }}>
      <TreePanelSplit primaryLabel="Features" secondaryLabel="Parts" storageKey="aether-cad.feature-parts-split" primary={<TreePanel
          ariaLabel="CAD features" title={`Features (${cadHistoryCount(workspace.itemNodes)})`} headerControls={[controls[0], controls[3]]}
          onCategoryChange={setCategory} filterLabel="Filter Features" filterInputID="items-filter" filterInputRef={filterRef} onFilterChange={setFilter}
          filterOptions={[
            { id: "body", label: "Bodies", icon: <AetherIcon name="cube" /> },
            { id: "sketch", label: "Sketches", icon: <AetherIcon name="sketch-nodes" /> },
            { id: "plane", label: "Planes and Axes", icon: <AetherIcon name="planes-axes" /> },
            { id: "image", label: "Images", icon: <AetherIcon name="image" /> },
          ]}
          id="parts-list" className="cad-items-tree"
          nodes={nodes}
          controls={controls} controlsLabel="Feature tree controls"
          menuItems={menuItems} menuLabel="Feature actions" onCommand={runMenu}
          onActivate={id=>cadWorkspace.dispatch({type:"item-action",id,actionID:"edit-feature"})}
          onMove={(id,targetID,position)=>cadWorkspace.dispatch({type:"move-item",id,targetID,position})}
          canMove={(id,target,position)=>{
            // Bodies left the feature list, so the last feature row is the end
            // of the list; dropping "after" it must latch at the very end.
            if(filter || category !== "all")return false;
            if(id==="rollback-bar")return position!=="inside"&&target.startsWith("feature/")&&!target.startsWith("feature/body/");
            if(id.startsWith("folder/"))return position==="inside"&&target.startsWith("folder/")&&id!==target;
            if(id.startsWith("feature/")&&!id.startsWith("feature/body/")){
              if(position==="inside")return target.startsWith("folder/");
              return target.startsWith("feature/")&&!target.startsWith("feature/body/");
            }
            return false;
          }}

          selectedIDs={selectedIDs}
          expandedIDs={workspace.expandedItemIDs}
          filter={filter}
          onSelect={selectRows}
          onToggle={(id) => cadWorkspace.dispatch({ type: "toggle-item", id })}
          onAction={(id, actionID) => cadWorkspace.dispatch({ type: "item-action", id, actionID })}
          emptyState={presentation.backendState === "failed" && !workspace.itemNodes.length
            ? "Aether CAD could not start — see the status bar and browser console."
            : "No matching items"}

        />} secondary={<CADPartsPanel
          nodes={bodies} selectedIDs={selectedIDs} onSelect={selectRows}
          onAction={dispatch} onShowAppearance={onShowAppearance}
        />} />
    </section>
  );
}
