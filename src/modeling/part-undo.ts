import type { PartDocument } from "@aether/core/document";

/** Session-local document snapshots; only successful rebuilds enter history. */
export class PartUndoHistory {
  private states: PartDocument[] = [];
  private index = -1;
  record(document: PartDocument) {
    if (this.states[this.index]?.documentId !== document.documentId) { this.states = []; this.index = -1; }
    if (JSON.stringify(this.states[this.index]) === JSON.stringify(document)) return;
    this.states = this.states.slice(0, this.index + 1);
    this.states.push(structuredClone(document));
    if (this.states.length > 50) this.states.shift();
    this.index = this.states.length - 1;
  }
  candidate(direction: -1 | 1): PartDocument | null {
    const value = this.states[this.index + direction];
    return value ? structuredClone(value) : null;
  }
  accept(direction: -1 | 1) { if (this.candidate(direction)) this.index += direction; }
}

export function installPartUndo(getDocument: () => PartDocument | null, apply: (doc: PartDocument) => Promise<void>, changed: () => void = () => {}, active: () => boolean = () => true) {
  const history = new PartUndoHistory();
  let restoring = false;
  window.addEventListener("aether-part-updated", () => {
    const document = getDocument();
    if (document && !restoring) history.record(document);
    changed();
  });
  /** One undo (-1) or redo (1) — the keyboard, tool bar and command palette all run this. */
  const step = async (direction: -1 | 1): Promise<boolean> => {
    const previous = restoring || !active() ? null : history.candidate(direction);
    if (!previous || previous.documentId !== getDocument()?.documentId) return false;
    restoring = true; changed();
    try { await apply(previous); history.accept(direction); return true; }
    catch { return false; /* The normal apply path reports the failure; keep the history cursor. */ }
    finally { restoring = false; changed(); }
  };
  window.addEventListener("keydown", async event => {
    if (!active() || event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "z") return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('input,textarea,select,[contenteditable="true"]') || document.querySelector('[role="dialog"],.cad-sketch-workspace,.cad-feature-dialog,.cad-plane-window')) return;
    if (restoring) { event.preventDefault(); return; }
    const direction = event.shiftKey ? 1 : -1;
    const previous = history.candidate(direction);
    if (!previous || previous.documentId !== getDocument()?.documentId) return;
    event.preventDefault();
    await step(direction);
  });
  return {
    step,
    canStep: (direction: -1 | 1) => active() && !restoring && history.candidate(direction)?.documentId === getDocument()?.documentId && getDocument() !== null,
    candidate: (direction: -1 | 1) => restoring ? null : history.candidate(direction),
    /** Native evaluation happens before this synchronous commit. */
    commit: (direction: -1 | 1, expected: PartDocument, applyEvaluated: () => void) => {
      if (restoring || JSON.stringify(history.candidate(direction)) !== JSON.stringify(expected)) throw Error('The undo history changed. Inspect the part again.');
      restoring = true;
      try { applyEvaluated(); history.accept(direction); }
      finally { restoring = false; }
    },
  };
}
