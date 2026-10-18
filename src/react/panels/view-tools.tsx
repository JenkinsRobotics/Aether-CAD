/** The View tray as sidebar panels — one per catalog group.
 *
 *  These were flyout menus hanging off the rail, which floated over whatever
 *  panel was open beside it. A panel cannot overlap its neighbours: the shell
 *  already keeps one panel open per side, so opening Orientation closes
 *  Properties the way every other rail entry does, in the same window chrome
 *  and the same place.
 *
 *  The list is read straight from `viewWorkspace`, so these panels and the
 *  ribbon can never disagree about what a View tool is.
 */
import { cadCommands, isCADCommandID } from "../../cad-command-registry";
import {
  type CADToolActionID,
  type CADToolDefinition,
  type CADToolGroupDefinition,
  cadRibbonWorkspace,
} from "../../cad-tool-catalog";
import { ToolIcon } from "@aether/ui";
import { useSyncExternalStore } from "react";

export const viewToolGroups = (): readonly CADToolGroupDefinition[] =>
  cadRibbonWorkspace("view").groups;

export function ViewToolsPanel({
  group,
  active,
  onAction,
}: {
  group: CADToolGroupDefinition;
  active: boolean;
  onAction: (action: CADToolActionID) => void;
}) {
  const commands = useSyncExternalStore(
    cadCommands.subscribe,
    cadCommands.snapshot,
    cadCommands.snapshot,
  );
  const state = (tool: CADToolDefinition) => {
    if (!tool.action) return { disabled: true, current: false, reason: tool.unavailableReason };
    if (!isCADCommandID(tool.action)) return { disabled: false, current: false };
    const command = commands[tool.action];
    if (!command.registered) return { disabled: true, current: false, reason: "Command is not connected to the current CAD session." };
    if (!command.enabled) return { disabled: true, current: false, reason: "Command requires an applicable selection or open document." };
    return { disabled: false, current: command.active };
  };
  return (
    <section className={`browser-panel${active ? " active" : ""}`} data-panel={group.id}>
      <header className="browser-title"><div><strong>{group.label}</strong></div></header>
      <div className="cad-view-tool-list" role="group" aria-label={group.label}>
        {group.tools.map((tool) => {
          const { disabled, current, reason } = state(tool);
          return (
            <button
              key={tool.id}
              type="button"
              data-tool-id={tool.id}
              aria-pressed={current}
              disabled={disabled}
              title={disabled ? reason : tool.label}
              onClick={() => tool.action && onAction(tool.action)}
            >
              <ToolIcon name={tool.icon} />
              <span>{tool.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
