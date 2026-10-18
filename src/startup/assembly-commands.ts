/** Registration for the Assembly authoring commands.
 *
 *  Eleven near-identical registrations: six open a dialog, five act on the
 *  current selection through the controller. They were inline in `main.ts`,
 *  interleaved with the FreeCAD build command and the tool UI.
 */
import { cadCommands, type CADCommandID } from "../cad-command-registry";
import { cadPresentation, type CADStartDialog } from "../cad-presentation-store";

/** The selection-acting half: each returns a promise the command discards. */
export interface AssemblyCommandHost {
  toggleSelectedInstanceGrounded(): Promise<unknown>;
  toggleSelectedInstanceSuppressed(): Promise<unknown>;
  removeSelectedInstance(): Promise<unknown>;
  toggleSelectedMateSuppressed(): Promise<unknown>;
  removeSelectedMate(): Promise<unknown>;
  /** Invalidate any standing mate preview before a new mate is authored. */
  resetMatePreview(): void;
}

const DIALOGS: readonly (readonly [CADCommandID, CADStartDialog])[] = [
  ["assembly-insert-component", "insert-component"],
  ["assembly-add-connector", "add-connector"],
  ["assembly-set-mate-dof-value", "set-mate-dof-value"],
  ["assembly-edit-mate-dof-limits", "edit-mate-dof-limits"],
  ["assembly-create-relation", "create-relation"],
];

export function registerAssemblyCommands(host: AssemblyCommandHost): void {
  for (const [command, dialog] of DIALOGS)
    cadCommands.register(command, () => {
      cadPresentation.dispatch({ type: "show-start-dialog", dialog });
    });

  // Creating a mate is the one dialog that has to clear the preview first, or
  // the new mate opens showing the previous one's result.
  cadCommands.register("assembly-create-mate", () => {
    host.resetMatePreview();
    cadPresentation.dispatch({ type: "show-start-dialog", dialog: "create-mate" });
  });

  // A failure here is already reported by the controller, so the command only
  // has to avoid an unhandled rejection.
  const act = (command: CADCommandID, run: () => Promise<unknown>) =>
    cadCommands.register(command, () => void run().catch(() => undefined));
  act("assembly-toggle-grounded", () => host.toggleSelectedInstanceGrounded());
  act("assembly-toggle-suppressed", () => host.toggleSelectedInstanceSuppressed());
  act("assembly-remove-instance", () => host.removeSelectedInstance());
  act("assembly-toggle-mate-suppressed", () => host.toggleSelectedMateSuppressed());
  act("assembly-remove-mate", () => host.removeSelectedMate());
}

/** Every command this module owns, so a test can prove none was dropped. */
export const assemblyCommandIDs: readonly CADCommandID[] = [
  ...DIALOGS.map(([id]) => id),
  "assembly-create-mate",
  "assembly-toggle-grounded",
  "assembly-toggle-suppressed",
  "assembly-remove-instance",
  "assembly-toggle-mate-suppressed",
  "assembly-remove-mate",
];
