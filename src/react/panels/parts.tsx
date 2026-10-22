/** Parts are a flat projection of the existing body tree, not a second model. */
import { useMemo, useState } from "react";
import { AetherIcon, TreePanel, FeatureTypeIcon, Menu, featureTreeMenuItems, type TreeNode } from "@aether/ui";
import { cadFeatureActions, cadTreeCommand } from "./feature-tree-commands";

export function partRows(nodes: readonly TreeNode[]): readonly TreeNode[] {
  return nodes.flatMap(node => node.id.startsWith("feature/body/") ? [node] : partRows(node.children ?? []));
}

export function CADPartsPanel({ nodes, selectedIDs, onSelect, onAction, onShowAppearance }: {
  nodes: readonly TreeNode[];
  selectedIDs: ReadonlySet<string>;
  onSelect: (ids: readonly string[], mode: "single" | "toggle" | "range") => void;
  onAction: (id: string, actionID: string) => void;
  onShowAppearance: () => void;
}) {
  const rows = useMemo(() => partRows(nodes), [nodes]);
  const items: TreeNode[] = rows.map(row => ({
    id: row.id,
    label: row.label,
    icon: <FeatureTypeIcon type="part" />,
    className: "aui-feature-tree-item",
    dimmed: row.dimmed,
    disabled: row.disabled,
    actions: (row.actions ?? []).map(action => ({ ...action,
      state: action.id === "body-visibility", pinned: action.id === "body-visibility" && !!row.dimmed,
    })),
  }));
  const [menu, setMenu] = useState<{id:string; x:number; y:number}|null>(null);
  const menuNode = rows.find(row => row.id === menu?.id);
  const menuActions = menuNode ? cadFeatureActions(menuNode, rows, selectedIDs, 0, true) : [];
  const selected = rows.find(row => selectedIDs.has(row.id));
  const canRename = selected?.actions?.some(action => action.id === "body-rename") ?? false;
  return <div className="cad-parts-panel" onKeyDown={event => {
    if (event.key !== "F2" || !selected || !canRename) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable='true']")) return;
    event.preventDefault();
    event.stopPropagation();
    onAction(selected.id, "body-rename");
  }}>
    <TreePanel title={`Parts (${rows.length})`} ariaLabel="CAD parts" nodes={items}
      menuItems={()=>[]} className="cad-parts-list" rowHeight={24} showFilter={false}
      selectedIDs={selectedIDs} onSelect={onSelect}
      controls={[{ id: "body-rename", label: "Rename part", icon: <AetherIcon name="pencil" />,
        shortcut: "F2", disabled: !canRename,
        onClick: () => { if (selected && canRename) onAction(selected.id, "body-rename"); } }]}
      onAction={onAction}
      onContextMenu={(id,x,y) => { if (!selectedIDs.has(id)) onSelect([id], "single"); setMenu({id,x,y}); }}
      emptyState={rows.length ? "No matching parts" : "Create or import a solid to see its parts here."} />
    {menu && menuNode && <Menu open ariaLabel="Part actions" anchor={{x:menu.x,y:menu.y}} items={featureTreeMenuItems(menuActions)} onClose={()=>setMenu(null)} onSelect={id=>{
      const action=menuActions.find(entry=>entry.item.id===id);
      if(action&&!action.item.disabled){
        if(action.request.command==="appearance"){onSelect([menuNode.id],"single");onShowAppearance();}
        else {const command=cadTreeCommand(action.request,menuNode);if(command?.type==="item-action")onAction(command.id,command.actionID);}
      }
      setMenu(null);
    }}/>} 
  </div>;
}
