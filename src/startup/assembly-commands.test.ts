import { describe, expect, it, vi } from "vitest";
import { cadCommands } from "../cad-command-registry";
import { cadPresentation, type CADPresentationAction } from "../cad-presentation-store";
import { registerAssemblyCommands, assemblyCommandIDs } from "./assembly-commands";

const host = () => ({
  toggleSelectedInstanceGrounded: vi.fn(async () => {}),
  toggleSelectedInstanceSuppressed: vi.fn(async () => {}),
  removeSelectedInstance: vi.fn(async () => {}),
  toggleSelectedMateSuppressed: vi.fn(async () => {}),
  removeSelectedMate: vi.fn(async () => {}),
  resetMatePreview: vi.fn(),
});

/** Registering a command does not enable it — the workspace gates these on
 *  what is selected — so a test that runs one opens the gate itself. */
const enableAll = () => {
  for (const id of assemblyCommandIDs) cadCommands.setEnabled(id, true);
};

/** The presentation store is a container: `dispatch` only forwards to the
 *  handler the app installs. Capturing that is how a command's intent is
 *  observed without standing the whole app up. */
const capture = () => {
  const actions: CADPresentationAction[] = [];
  const release = cadPresentation.registerActionHandler((action) => {
    actions.push(action);
  });
  return { actions, release };
};

describe("registering the Assembly commands", () => {
  it("registers every command it claims to own, exactly once", () => {
    registerAssemblyCommands(host());
    const states = cadCommands.snapshot();
    for (const id of assemblyCommandIDs)
      expect(states[id]?.registered, `${id} was not registered`).toBe(true);
    expect(new Set(assemblyCommandIDs).size).toBe(assemblyCommandIDs.length);
  });

  it("asks for the dialog each command stands for", () => {
    registerAssemblyCommands(host());
    enableAll();
    const { actions, release } = capture();
    try {
      for (const [command, dialog] of [
        ["assembly-insert-component", "insert-component"],
        ["assembly-add-connector", "add-connector"],
        ["assembly-set-mate-dof-value", "set-mate-dof-value"],
        ["assembly-edit-mate-dof-limits", "edit-mate-dof-limits"],
        ["assembly-create-relation", "create-relation"],
      ] as const) {
        actions.length = 0;
        cadCommands.execute(command);
        expect(actions).toEqual([{ type: "show-start-dialog", dialog }]);
      }
    } finally {
      release();
    }
  });

  it("clears the standing mate preview before asking for Create mate", () => {
    // Without this the new mate dialog opens showing the previous mate's
    // preview, which reads as though it had already solved.
    const target = host();
    registerAssemblyCommands(target);
    enableAll();
    const { actions, release } = capture();
    try {
      cadCommands.execute("assembly-create-mate");
      expect(target.resetMatePreview).toHaveBeenCalled();
      expect(actions).toEqual([{ type: "show-start-dialog", dialog: "create-mate" }]);
    } finally {
      release();
    }
  });

  it("routes the selection commands to the controller", () => {
    const target = host();
    registerAssemblyCommands(target);
    enableAll();
    cadCommands.execute("assembly-toggle-grounded");
    cadCommands.execute("assembly-toggle-suppressed");
    cadCommands.execute("assembly-remove-instance");
    cadCommands.execute("assembly-toggle-mate-suppressed");
    cadCommands.execute("assembly-remove-mate");
    expect(target.toggleSelectedInstanceGrounded).toHaveBeenCalled();
    expect(target.toggleSelectedInstanceSuppressed).toHaveBeenCalled();
    expect(target.removeSelectedInstance).toHaveBeenCalled();
    expect(target.toggleSelectedMateSuppressed).toHaveBeenCalled();
    expect(target.removeSelectedMate).toHaveBeenCalled();
  });

  it("swallows a controller failure rather than leaving it unhandled", async () => {
    // The controller reports its own errors; the command must not turn one
    // into an unhandled rejection.
    const target = {
      ...host(),
      removeSelectedMate: vi.fn(async () => { throw new Error("nope"); }),
    };
    registerAssemblyCommands(target);
    enableAll();
    expect(() => cadCommands.execute("assembly-remove-mate")).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(target.removeSelectedMate).toHaveBeenCalled();
  });
});
