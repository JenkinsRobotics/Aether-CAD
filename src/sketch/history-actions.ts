import { cadCommands } from "../cad-command-registry";
import type { createSketchHistory, SketchSnapshot } from "./history";
/** Commands and keyboard use the same sketch history, independent of DOM buttons. */
export function mountSketchHistoryActions(o: {
  history: ReturnType<typeof createSketchHistory>;
  enabled(): boolean;
  current(): SketchSnapshot;
  cancelGesture(): void;
  restore(snapshot: SketchSnapshot): void;
  pending?: { undo(): boolean; redo(): boolean; canUndo(): boolean; canRedo(): boolean };
}) {
  const restore = (direction: "undo" | "redo") => {
    if (!o.enabled()) return;
    if (o.pending?.[direction]()) { refresh(); return; }
    // A new unfinished curve is a branch. Do not redo old document geometry
    // into it when there are no pending points left to restore.
    if (direction === "redo" && o.pending?.canUndo()) return;
    o.cancelGesture();
    const snapshot = o.history[direction](o.current());
    if (snapshot) o.restore(snapshot);
    refresh();
  };
  const undo = () => restore("undo"), redo = () => restore("redo");
  const dispose = [cadCommands.register("sketch-undo", undo), cadCommands.register("sketch-redo", redo)];
  function refresh() {
    cadCommands.setEnabled("sketch-undo", o.enabled() && (!!o.pending?.canUndo() || o.history.canUndo()));
    cadCommands.setEnabled("sketch-redo", o.enabled() && (!!o.pending?.canRedo() || (!o.pending?.canUndo() && o.history.canRedo())));
  }
  return { undo, redo, refresh, dispose: () => dispose.forEach(dispose => dispose()) };
}
