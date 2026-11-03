import { cadCommands, type CADCommandID } from "../../cad-command-registry";
import { cadAssemblyWorkspace } from "../../cad-assembly-workspace-store";
/** Parts are a flat projection of the existing body tree, not a second model. */
import { useMemo, useSyncExternalStore } from "react";
import { TreePanel, FeatureTypeIcon, featureTreeMenuItems, type TreeNode } from "@aether/ui";
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
      state: action.id === "body-visibility",
    })),
  }));
  const actionsFor = (id: string) => {
    const node = rows.find(row => row.id === id);
    return node ? cadFeatureActions(node, rows, selectedIDs, 0, true) : [];
  };
  const menuItems = (id: string) => [
    ...featureTreeMenuItems(actionsFor(id)),
    {id:'zoom-part',label:'Zoom to part',separatorBefore:true},
    {id:'isolate-part',label:'Isolate part'},
    {id:'exit-isolation',label:'Exit isolation'},
  ];
  const run = (id: string, commandID: string) => {
    const node = rows.find(row => row.id === id);
    if (!node) return;
    if (commandID === 'zoom-part') cadViewportContext.zoomTo([id.slice(13)]);
    else if (commandID === 'isolate-part') cadViewportContext.isolate(id.slice(13));
    else if (commandID === 'exit-isolation') cadViewportContext.isolate(null);
    else {
      const action = actionsFor(id).find(entry => entry.item.id === commandID);
      if (!action || action.item.disabled) return;
      if (action.request.command === 'appearance') { onSelect([id], 'single'); onShowAppearance(); }
      else {
        const command = cadTreeCommand(action.request, node);
        if (command?.type === 'item-action') onAction(command.id, command.actionID);
      }
    }
  };
  return <div className="cad-parts-panel">
    <TreePanel actionPlacement="header" title={`Parts (${rows.length})`} ariaLabel="CAD parts" nodes={items}
      backgroundItems={panelMenu.items} onBackgroundCommand={panelMenu.run}
      menuItems={menuItems} onCommand={run} menuLabel="Part actions"
      className="cad-parts-list" rowHeight={24} showFilter={false}
      selectedIDs={selectedIDs} onSelect={onSelect} onAction={onAction}
      emptyState={rows.length ? "No matching parts" : "Create or import a solid to see its parts here."} />
  </div>;
}

/** Assembly occurrences come from the same canonical projection as the mate
 * inspector. Do not count only authored Part-document body IDs here. */
export function CADAssemblyPartsPanel() {
  const commands = useSyncExternalStore(cadCommands.subscribe, cadCommands.snapshot, cadCommands.snapshot);
  const assembly = useSyncExternalStore(cadAssemblyWorkspace.subscribe, cadAssemblyWorkspace.snapshot, cadAssemblyWorkspace.snapshot);
  const rows = assembly.data?.instanceRows ?? [];
  const panelMenu = useCADPanelContext(rows, "assembly");
  const selected = (id: string) => cadAssemblyWorkspace.dispatch({type:'select-entities',ids:[id],mode:'single'});
  const menuCommand = (id: CADCommandID, label: string, separatorBefore = false) => ({id,label,separatorBefore,disabled:!commands[id].enabled});
  const componentItems = [
      {...menuCommand('assembly-edit-component','Component properties…'),shortcut:'F2'},
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
      {...menuCommand('assembly-remove-instance','Remove component',true),danger:true,shortcut:'Delete'},
    ];
  return <div className="cad-parts-panel">
    <TreePanel actionPlacement="header" title={`Components (${rows.length})`} ariaLabel="CAD assembly components"
      backgroundItems={panelMenu.items} onBackgroundCommand={panelMenu.run}
      nodes={rows} rowHeight={24} showFilter={false} className="cad-parts-list"
      selectedIDs={assembly.selectedEntityIDs}
      onSelect={(ids, mode) => cadAssemblyWorkspace.dispatch({ type: "select-entities", ids, mode })}
      onActivate={id => { selected(id); cadCommands.execute('assembly-edit-component'); }}
      menuItems={() => componentItems} menuLabel="Component actions"
      onCommand={(id, action) => { selected(id); cadCommands.execute(action as CADCommandID); }}
      emptyState="No components." />

  </div>;
}
