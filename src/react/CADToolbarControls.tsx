import { useState, useSyncExternalStore } from "react";
import { AetherIcon, IconButton, MenuButton, Popover, type MenuItem } from "@aether/ui";
import { cadCameraPresentation } from "../cad-camera-presentation-store";
import { cadCommands, isCADCommandID } from "../cad-command-registry";
import { cadWorkspace } from "../cad-workspace-store";
import { cameraMenuItems, selectCameraMenuItem } from "./chrome/camera-menu";
import { SelectionFilterHud } from "./chrome/viewport";
import { findTreeNode } from "./panels/shared";

/** The integrated toolbar uses the same camera, display and selection actions
 * as the viewport controls. It owns no alternative rendering or selection state. */
export function CADToolbarControls({ history, onHistory }: {
  history: readonly { id: string; label: string; disabled?: boolean }[];
  onHistory: (id: string) => void;
}) {
  const commands = useSyncExternalStore(cadCommands.subscribe, cadCommands.snapshot, cadCommands.snapshot);
  const camera = useSyncExternalStore(cadCameraPresentation.subscribe, cadCameraPresentation.snapshot, cadCameraPresentation.snapshot);
  const workspace = useSyncExternalStore(cadWorkspace.subscribe, cadWorkspace.snapshot, cadWorkspace.snapshot);
  const [selectionAnchor, setSelectionAnchor] = useState<HTMLElement | null>(null);
  const plane = findTreeNode(workspace.itemNodes, "reference/top-plane");
  const run = (id: string) => {
    if (id === "top-plane") cadWorkspace.dispatch({ type: "item-action", id: "reference/top-plane", actionID: "toggle-visibility" });
    else if (isCADCommandID(id)) cadCommands.execute(id);
  };
  const choices = (items: readonly (readonly [string, string])[]): MenuItem[] => items.map(([id, label]) => {
    const state = isCADCommandID(id) ? commands[id] : undefined;
    return { id, label, kind: "radio", checked: !!state?.active, disabled: !state?.enabled || !state.registered };
  });
  const wireframe = commands["display-wireframe"].active;
  return <>
    <div role="group" aria-label="History">
      {history.map((item, index) => <IconButton key={item.id} label={item.label} appearance="glyph" disabled={item.disabled} onClick={() => onHistory(item.id)}><AetherIcon name={index ? "redo" : "undo"}/></IconButton>)}
    </div>
    <div role="group" aria-label="View and selection">
      <MenuButton label="Camera views" items={cameraMenuItems(camera.projection)} onSelect={selectCameraMenuItem}><AetherIcon name="cube"/></MenuButton>
      <MenuButton label="Display style" items={choices([
        ["display-shaded", "Shaded"], ["display-shaded-edges", "Shaded with edges"],
        ["display-wireframe", "Wireframe"], ["display-hidden-line", "Hidden line"],
        ["display-ghost", "Ghost"],
      ])} onSelect={run}><AetherIcon name={wireframe ? "cube-transparent" : "display"}/></MenuButton>
      <MenuButton label="Grid and construction planes" items={[
        ...choices([["ground-none", "No ground"], ["ground-grid", "Grid"], ["ground-floor", "Floor"], ["ground-both", "Grid and floor"]]),
        { id: "top-plane", label: "Top construction plane", kind: "checkbox", checked: !!plane && !plane.dimmed, disabled: !plane, separatorBefore: true },
      ]} onSelect={run}><AetherIcon name="grid-3"/></MenuButton>
      <IconButton label="Frame" appearance="glyph" disabled={!commands["fit-view"].enabled || !commands["fit-view"].registered} onClick={() => cadCommands.execute("fit-view")}><AetherIcon name="fit"/></IconButton>
      <IconButton label="Selection filters" appearance="glyph" aria-expanded={!!selectionAnchor} aria-haspopup="dialog" onClick={event => setSelectionAnchor(selectionAnchor ? null : event.currentTarget)}><AetherIcon name="filter"/></IconButton>
    </div>
    <Popover open={!!selectionAnchor} anchor={selectionAnchor} placement="top-end" ariaLabel="Selection filters" onClose={() => setSelectionAnchor(null)}><SelectionFilterHud/></Popover>
  </>;
}
