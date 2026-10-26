import { cadCommands, type CADCommandID } from "../../cad-command-registry";
import { cadAssemblyWorkspace } from "../../cad-assembly-workspace-store";
/** Parts are a flat projection of the existing body tree, not a second model. */
import { useMemo, useState, useSyncExternalStore } from "react";
import { AetherIcon, Button, TreePanel, FeatureTypeIcon, Menu, featureTreeMenuItems, type TreeNode } from "@aether/ui";
import { useCADPanelContext } from "./panel-context-commands";
import { cadViewportContext } from "../../viewport/context-menu";
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
  const panelMenu = useCADPanelContext(rows, "parts");
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
      backgroundItems={panelMenu.items} onBackgroundCommand={panelMenu.run}
      menuItems={()=>[]} className="cad-parts-list" rowHeight={24} showFilter={false}
      selectedIDs={selectedIDs} onSelect={onSelect}
      controls={[{ id: "body-rename", label: "Rename part", icon: <AetherIcon name="pencil" />,
        shortcut: "F2", disabled: !canRename,
        onClick: () => { if (selected && canRename) onAction(selected.id, "body-rename"); } }]}
      onAction={onAction}
      onContextMenu={(id,x,y) => { if (!selectedIDs.has(id)) onSelect([id], "single"); setMenu({id,x,y}); }}
      emptyState={rows.length ? "No matching parts" : "Create or import a solid to see its parts here."} />
    {menu && menuNode && <Menu open ariaLabel="Part actions" anchor={{x:menu.x,y:menu.y}} items={[...featureTreeMenuItems(menuActions),
      {id:'zoom-part',label:'Zoom to part',separatorBefore:true},
      {id:'isolate-part',label:'Isolate part'},
      {id:'exit-isolation',label:'Exit isolation'},
    ]} onClose={()=>setMenu(null)} onSelect={id=>{
      if(id==='zoom-part')cadViewportContext.zoomTo([menuNode.id.slice(13)]);
      else if(id==='isolate-part')cadViewportContext.isolate(menuNode.id.slice(13));
      else if(id==='exit-isolation')cadViewportContext.isolate(null);
      const action=menuActions.find(entry=>entry.item.id===id);
      if(action&&!action.item.disabled){
        if(action.request.command==="appearance"){onSelect([menuNode.id],"single");onShowAppearance();}
        else {const command=cadTreeCommand(action.request,menuNode);if(command?.type==="item-action")onAction(command.id,command.actionID);}
      }
      setMenu(null);
    }}/>} 
  </div>;
}


/** Assembly occurrences come from the same canonical projection as the mate
 * inspector. Do not count only authored Part-document body IDs here. */
export function CADAssemblyPartsPanel() {
  const commands = useSyncExternalStore(cadCommands.subscribe, cadCommands.snapshot, cadCommands.snapshot);
  const canInsert = commands["assembly-insert-component"].enabled;
  const assembly = useSyncExternalStore(cadAssemblyWorkspace.subscribe, cadAssemblyWorkspace.snapshot, cadAssemblyWorkspace.snapshot);
  const rows = assembly.data?.instanceRows ?? [];
  const panelMenu = useCADPanelContext(rows, "assembly");
  const [menu, setMenu] = useState<{x:number; y:number; id:string}|null>(null);
  const selected = (id: string) => cadAssemblyWorkspace.dispatch({type:'select-entities',ids:[id],mode:'single'});
  const menuCommand = (id: CADCommandID, label: string, separatorBefore = false) => ({id,label,separatorBefore,disabled:!commands[id].enabled});
  return <div className="cad-parts-panel">
    <TreePanel title={`Components (${rows.length})`} ariaLabel="CAD assembly components"
      backgroundItems={panelMenu.items} onBackgroundCommand={panelMenu.run}
      nodes={rows} rowHeight={24} showFilter={false} className="cad-parts-list"
      selectedIDs={assembly.selectedEntityIDs}
      onSelect={(ids, mode) => cadAssemblyWorkspace.dispatch({ type: "select-entities", ids, mode })}
      onActivate={id => { selected(id); cadCommands.execute('assembly-edit-component'); }}
      menuItems={() => []}
      onContextMenu={(id, x, y) => { selected(id); setMenu({id,x,y}); }}
      headerControls={[{ id: "insert", label: "Insert Part", icon: <AetherIcon name="plus"/>,
        disabled: !canInsert,
        onClick: () => cadCommands.execute("assembly-insert-component") }]}
      emptyState={<Button disabled={!canInsert} onClick={() => cadCommands.execute("assembly-insert-component")}>Insert Part…</Button>} />
    {menu && <Menu open ariaLabel="Component actions" anchor={{x:menu.x,y:menu.y}} items={[
      menuCommand('assembly-edit-component','Component properties…'),
      menuCommand('assembly-open-component-part','Open source Part'),
      menuCommand('assembly-toggle-visible','Show / hide component',true),
      menuCommand('assembly-toggle-grounded',commands['assembly-toggle-grounded'].active ? 'Float component' : 'Ground component'),
      menuCommand('assembly-toggle-suppressed',commands['assembly-toggle-suppressed'].active ? 'Restore component' : 'Suppress component'),
      menuCommand('assembly-add-connector','Add mate connector…',true),
      menuCommand('assembly-create-mate','Create mate…'),
      menuCommand('assembly-as-built-joint','As-built joint…'),
      menuCommand('assembly-linked-copy','Linked copy',true),
      menuCommand('assembly-make-independent','Independent copy'),
      menuCommand('assembly-part-properties','Part metadata…'),
      {...menuCommand('assembly-remove-instance','Remove component',true),danger:true},
    ]} onClose={() => setMenu(null)} onSelect={id => { selected(menu.id); cadCommands.execute(id as CADCommandID); setMenu(null); }}/>}
  </div>;
}
