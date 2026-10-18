/** Command-driven buttons: the floating rail and the icon button. */
import { type CADCommandID, type CADCommandState, cadCommands } from "../../cad-command-registry";
import { cadPresentation, type CADBrowserPanel } from "../../cad-presentation-store";
import { CadIcon } from "../CadIcon";
import { IconButton, RailButton } from "@aether/ui";
import { type ReactNode, useSyncExternalStore } from "react";
import type { CadIconName } from "../CadIcon";

interface FloatingCommandProps {
  icon: CadIconName;
  label: string;
  command?: CADCommandID;
  panel?: CADBrowserPanel;
  active?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onActivate?: () => void;
}

export function FloatingCommand({
  icon,
  label,
  command,
  panel,
  active,
  disabled,
  disabledReason,
  onActivate,
}: FloatingCommandProps) {
  const commands = useSyncExternalStore(
    cadCommands.subscribe,
    cadCommands.snapshot,
    cadCommands.snapshot,
  );
  const commandState: CADCommandState | undefined = command
    ? commands[command]
    : undefined;
  return (
    <RailButton
      className="floating-command"
      label={label}
      active={Boolean(active || commandState?.active)}
      data-command={command}
      data-browser-panel={panel}
      disabled={disabled || (commandState ? !commandState.enabled || !commandState.registered : false)}
      aria-description={disabledReason}
      onClick={() => {
        if (panel) cadPresentation.dispatch({ type: "select-panel", panel });
        if (command) cadCommands.execute(command);
        onActivate?.();
      }}
    >
      <span className="floating-command-icon"><CadIcon name={icon} /></span>
      <span className="floating-command-label" title={disabledReason}>{label}</span>
    </RailButton>
  );
}

export function CommandIconButton({
  command,
  label,
  id,
  children,
}: {
  command: CADCommandID;
  label: string;
  id?: string;
  children: ReactNode;
}) {
  const commands = useSyncExternalStore(
    cadCommands.subscribe,
    cadCommands.snapshot,
    cadCommands.snapshot,
  );
  const state = commands[command];
  return (
    <IconButton
      id={id}
      label={label}
      data-command={command}
      aria-pressed={state.active || undefined}
      disabled={!state.enabled || !state.registered}
      onClick={() => cadCommands.execute(command)}
    >
      {children}
    </IconButton>
  );
}



// The workbench trays live in ./panels, one file each.
