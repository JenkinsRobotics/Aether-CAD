/** Registration for the Assembly authoring commands.
 *
 *  Eleven near-identical registrations: six open a dialog, five act on the
 *  current selection through the controller. They were inline in `main.ts`,
 *  interleaved with the engine build command and the tool UI.
 */
import { cadCommands, type CADCommandID } from "../cad-command-registry";
import { cadPresentation, type CADStartDialog } from "../cad-presentation-store";

/** The selection-acting half: each returns a promise the command discards. */
export interface AssemblyCommandHost {
  toggleSelectedInstanceGrounded(): Promise<unknown>;
  toggleSelectedInstanceSuppressed(): Promise<unknown>;
  removeSelectedInstance(): Promise<unknown>;
  /** paste_new: an independent copy of the selected occurrence and its part. */
  copySelectedInstanceIndependent(): Promise<unknown>;
  /** Another occurrence of the selected part. */
  addLinkedCopyOfSelectedInstance(): Promise<unknown>;
  /** joint.rigid_group over the selected occurrences. */
  addRigidGroupFromSelection(): Promise<unknown>;
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
  ["assembly-create-contact-set", "create-contact-set"],
  ["assembly-part-properties", "part-properties"],
  ["assembly-bodies-to-component", "bodies-to-component"],
  ["assembly-as-built-joint", "as-built-joint"],
  ["assembly-reach-point", "reach-point"],
  ["assembly-insert-standard-part", "insert-standard-part"],
  ["assembly-resize-standard-part", "resize-standard-part"],
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
  act("assembly-make-independent", () => host.copySelectedInstanceIndependent());
  act("assembly-linked-copy", () => host.addLinkedCopyOfSelectedInstance());
  act("assembly-rigid-group", () => host.addRigidGroupFromSelection());
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
  "assembly-make-independent",
  "assembly-linked-copy",
  "assembly-rigid-group",
  "assembly-toggle-mate-suppressed",
  "assembly-remove-mate",
];
