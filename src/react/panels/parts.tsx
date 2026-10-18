/** Parts are a flat projection of the existing body tree, not a second model. */
import { useMemo, useState, useSyncExternalStore } from "react";
import { AetherIcon, ListBox, Menu, featureTreeMenuItems, type ListBoxItem, type TreeNode } from "@aether/ui";
import { cadFeatureActions, cadTreeCommand } from "./feature-tree-commands";
import { cadObjectAppearance } from "../../cad-object-appearance";
import { cadAppearance } from "../../cad-appearance-store";
import { cadMaterialPresets, renderMaterials, materialValues, matchesMaterial } from "../../cad-render-materials";
import { resolvePartDisplay } from "../../viewport/part-display";
import { readViewportThemeOverride } from "../../viewport/suite-viewport-theme";
import { resolveAppearance } from "../../viewport/appearance-themes";

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
  const appearance = useSyncExternalStore(cadAppearance.subscribe, cadAppearance.snapshot, cadAppearance.snapshot);
  const color = `#${resolveAppearance(appearance,readViewportThemeOverride()).bodyColor.toString(16).padStart(6, "0")}`;
  const objects = useSyncExternalStore(cadObjectAppearance.subscribe, cadObjectAppearance.snapshot, cadObjectAppearance.snapshot);
  const custom = useSyncExternalStore(cadMaterialPresets.subscribe,cadMaterialPresets.snapshot,cadMaterialPresets.snapshot);
  const library = [...renderMaterials,...custom];
  const rows = useMemo(() => partRows(nodes), [nodes]);
  const items: ListBoxItem[] = rows.map(row => ({
    id: row.id,
    label: row.label,
    // The current body contract has names/visibility, not assigned materials.
    // Do not mistake device-level preview colors for saved material metadata.
    description: (()=>{const value=objects.find(object=>`feature/body/${object.id}`===row.id)?.value;
      const values=materialValues(resolvePartDisplay(resolveAppearance(appearance,readViewportThemeOverride()),value));
      const preset=library.find(p=>matchesMaterial(p.values,values));return preset?`${preset.name} · appearance`:"Custom appearance";})(),
    icon: <AetherIcon name="cube" />,
    dimmed: row.dimmed,
    disabled: row.disabled,
    actions: [
      { id: "preview-appearance", label: `Preview appearance for ${row.label}`,
        icon: <span className="cad-part-appearance-swatch" style={{ backgroundColor: objects.find(object => `feature/body/${object.id}` === row.id)?.value.color ?? color }} aria-hidden="true" />, pinned: true },
      ...(row.actions ?? []).map(action => ({ ...action, pinned: action.id === "body-visibility" })),
    ],
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
    <ListBox title={`Parts (${rows.length})`} ariaLabel="CAD parts" items={items}
      className="cad-parts-list" rowHeight={44}
      selectedIDs={selectedIDs} selectionMode="single" onSelect={onSelect}
      controls={[{ id: "body-rename", label: "Rename part", icon: <AetherIcon name="pencil" />,
        shortcut: "F2", disabled: !canRename,
        onClick: () => { if (selected && canRename) onAction(selected.id, "body-rename"); } }]}
      onAction={(id, actionID) => {
        if (actionID === "preview-appearance") { onSelect([id], "single"); onShowAppearance(); }
        else onAction(id, actionID);
      }}
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
