import { historyShortcutDirection } from "../shortcuts";

/** Dispatch only when the Assembly owns keyboard focus. Text editing and modal
 * authoring keep their own undo behavior. The controller owns validation. */
export function installAssemblyHistoryShortcuts(options: {
  active(): boolean;
  canStep(direction: -1 | 1): boolean;
  step(direction: -1 | 1): Promise<void>;
  onError(error: unknown): void;
}): () => void {
  let pending = false;
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || !options.active()) return;
    const direction = historyShortcutDirection(event);
    if (direction === null) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('input,textarea,select,[contenteditable="true"]')
      || document.querySelector('[role="dialog"],.cad-sketch-workspace,.cad-feature-dialog,.cad-plane-window')) return;
    if (!options.canStep(direction)) return;
    event.preventDefault();
    if (pending) return;
    pending = true;
    void options.step(direction).catch(options.onError).finally(() => { pending = false; });
  };
  window.addEventListener("keydown", keydown);
  return () => window.removeEventListener("keydown", keydown);
}
